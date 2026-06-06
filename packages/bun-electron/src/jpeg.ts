// JPEG decoder for nativeImage: supports both baseline (sequential DCT) and
// progressive JPEGs (SOF2, spectral selection + successive approximation),
// Huffman entropy coding, chroma subsampling, and restart intervals.
// Arithmetic coding (SOF9+) is not supported (decode returns null).
//
// Coefficients from every scan are accumulated per block first; dequantization,
// the inverse DCT, and YCbCr->RGB run once at the end. This is what lets a
// progressive image's DC and AC scans combine before reconstruction.

import type { RawImage } from "./png";

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

interface HuffTable {
  mincode: number[];
  maxcode: number[];
  valptr: number[];
  values: number[];
}

function buildHuffTable(counts: number[], values: number[]): HuffTable {
  const mincode = new Array(17).fill(0);
  const maxcode = new Array(17).fill(-1);
  const valptr = new Array(17).fill(0);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    if (counts[l] > 0) {
      valptr[l] = k;
      mincode[l] = code;
      code += counts[l];
      maxcode[l] = code - 1;
      k += counts[l];
    } else {
      maxcode[l] = -1;
    }
    code <<= 1;
  }
  return { mincode, maxcode, valptr, values };
}

interface Component {
  id: number;
  h: number;
  v: number;
  quantId: number;
  dcTable: number;
  acTable: number;
  pred: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  blocksPerLineForMcu: number;
  blocksPerColumnForMcu: number;
  // Per-block natural-order coefficients, 64 per block.
  blockData: Int16Array;
}

// A bit reader over entropy-coded data that unstuffs 0xFF00 and stops at the
// next marker (which it leaves in the stream for the caller).
class BitReader {
  pos: number;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(private readonly data: Buffer, start: number) {
    this.pos = start;
  }

  reset(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  atMarker(): boolean {
    return this.data[this.pos] === 0xff && (this.data[this.pos + 1] ?? 0) !== 0x00;
  }

  bit(): number {
    if (this.bitCnt === 0) {
      let b = this.data[this.pos];
      if (b === 0xff) {
        const next = this.data[this.pos + 1] ?? 0;
        if (next === 0x00) {
          this.pos += 2;
        } else {
          // Marker: feed zero bits, leave it for the scan loop to handle.
          return 0;
        }
      } else {
        this.pos++;
      }
      this.bitBuf = b;
      this.bitCnt = 8;
    }
    this.bitCnt--;
    return (this.bitBuf >> this.bitCnt) & 1;
  }

  receive(n: number): number {
    let v = 0;
    while (n-- > 0) v = (v << 1) | this.bit();
    return v;
  }

  decode(table: HuffTable): number {
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | this.bit();
      if (table.maxcode[l] >= 0 && code <= table.maxcode[l]) {
        return table.values[table.valptr[l] + code - table.mincode[l]];
      }
    }
    return 0;
  }
}

function extend(v: number, n: number): number {
  return n !== 0 && v < 1 << (n - 1) ? v - (1 << n) + 1 : v;
}

const IDCT_COS: number[][] = (() => {
  const t: number[][] = [];
  for (let u = 0; u < 8; u++) {
    t[u] = [];
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) t[u][x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return t;
})();

function idct8x8(block: Float64Array, out: Int16Array): void {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += IDCT_COS[u][x] * block[y * 8 + u];
      tmp[y * 8 + x] = s * 0.5;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += IDCT_COS[v][y] * tmp[v * 8 + x];
      const val = Math.round(s * 0.5) + 128;
      out[y * 8 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
}

export function decodeJPEG(buf: Buffer): RawImage | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  const quant: (Int32Array | null)[] = [null, null, null, null];
  const huffDC: (HuffTable | null)[] = [null, null, null, null];
  const huffAC: (HuffTable | null)[] = [null, null, null, null];
  let width = 0;
  let height = 0;
  let components: Component[] = [];
  let restartInterval = 0;
  let progressive = false;
  let frameReady = false;
  let hMax = 1;
  let vMax = 1;
  let mcusPerLine = 0;
  let mcusPerColumn = 0;

  while (pos + 1 < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1];
    pos += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > buf.length) break;
    const len = buf.readUInt16BE(pos);
    const segStart = pos + 2;
    const segEnd = pos + len;

    if (marker === 0xdb) {
      let p = segStart;
      while (p < segEnd) {
        const pq = buf[p] >> 4;
        const tq = buf[p] & 15;
        p++;
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i++) {
          table[i] = pq === 0 ? buf[p++] : ((buf[p] << 8) | buf[p + 1]);
          if (pq !== 0) p += 2;
        }
        quant[tq] = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      progressive = marker === 0xc2;
      height = buf.readUInt16BE(segStart + 1);
      width = buf.readUInt16BE(segStart + 3);
      const count = buf[segStart + 5];
      components = [];
      let p = segStart + 6;
      for (let i = 0; i < count; i++) {
        components.push({
          id: buf[p],
          h: buf[p + 1] >> 4,
          v: buf[p + 1] & 15,
          quantId: buf[p + 2],
          dcTable: 0,
          acTable: 0,
          pred: 0,
          blocksPerLine: 0,
          blocksPerColumn: 0,
          blocksPerLineForMcu: 0,
          blocksPerColumnForMcu: 0,
          blockData: new Int16Array(0),
        });
        p += 3;
      }
      hMax = Math.max(...components.map((c) => c.h));
      vMax = Math.max(...components.map((c) => c.v));
      mcusPerLine = Math.ceil(width / (8 * hMax));
      mcusPerColumn = Math.ceil(height / (8 * vMax));
      for (const c of components) {
        c.blocksPerLine = Math.ceil((Math.ceil(width / 8) * c.h) / hMax);
        c.blocksPerColumn = Math.ceil((Math.ceil(height / 8) * c.v) / vMax);
        c.blocksPerLineForMcu = mcusPerLine * c.h;
        c.blocksPerColumnForMcu = mcusPerColumn * c.v;
        c.blockData = new Int16Array(c.blocksPerLineForMcu * c.blocksPerColumnForMcu * 64);
      }
      frameReady = true;
    } else if (marker === 0xc4) {
      let p = segStart;
      while (p < segEnd) {
        const tc = buf[p] >> 4;
        const th = buf[p] & 15;
        p++;
        const counts = [0];
        let total = 0;
        for (let l = 1; l <= 16; l++) {
          counts[l] = buf[p++];
          total += counts[l];
        }
        const values: number[] = [];
        for (let i = 0; i < total; i++) values.push(buf[p++]);
        const table = buildHuffTable(counts, values);
        if (tc === 0) huffDC[th] = table;
        else huffAC[th] = table;
      }
    } else if (marker === 0xdd) {
      restartInterval = buf.readUInt16BE(segStart);
    } else if (marker >= 0xc5 && marker <= 0xcf && marker !== 0xc8) {
      return null; // arithmetic / other unsupported frame types
    } else if (marker === 0xda) {
      if (!frameReady) return null;
      const ns = buf[segStart];
      let p = segStart + 1;
      const scanComponents: Component[] = [];
      for (let i = 0; i < ns; i++) {
        const cs = buf[p];
        const comp = components.find((c) => c.id === cs);
        if (comp) {
          comp.dcTable = buf[p + 1] >> 4;
          comp.acTable = buf[p + 1] & 15;
          scanComponents.push(comp);
        }
        p += 2;
      }
      const ss = buf[p];
      const se = buf[p + 1];
      const ahl = buf[p + 2];
      const ah = ahl >> 4;
      const al = ahl & 15;
      pos = p + 3;
      pos = decodeScan(
        buf, pos, scanComponents, components, restartInterval, progressive,
        ss, se, ah, al, mcusPerLine, mcusPerColumn, huffDC, huffAC,
      );
      continue;
    }
    pos = segEnd;
  }

  if (!frameReady) return null;
  return reconstruct(buf, width, height, components, quant, hMax, vMax);
}

function decodeScan(
  buf: Buffer,
  start: number,
  scanComponents: Component[],
  allComponents: Component[],
  restartInterval: number,
  progressive: boolean,
  ss: number,
  se: number,
  ah: number,
  al: number,
  mcusPerLine: number,
  mcusPerColumn: number,
  huffDC: (HuffTable | null)[],
  huffAC: (HuffTable | null)[],
): number {
  const reader = new BitReader(buf, start);
  let eobrun = 0;
  for (const c of scanComponents) c.pred = 0;

  const decodeBaselineBlock = (comp: Component, off: number) => {
    const dc = huffDC[comp.dcTable]!;
    const ac = huffAC[comp.acTable]!;
    const t = reader.decode(dc);
    const diff = t ? extend(reader.receive(t), t) : 0;
    comp.pred += diff;
    comp.blockData[off] = comp.pred;
    let k = 1;
    while (k < 64) {
      const rs = reader.decode(ac);
      const r = rs >> 4;
      const s = rs & 15;
      if (s === 0) {
        if (r === 15) {
          k += 16;
          continue;
        }
        break;
      }
      k += r;
      if (k > 63) break;
      comp.blockData[off + ZIGZAG[k]] = extend(reader.receive(s), s);
      k++;
    }
  };

  const decodeDCFirst = (comp: Component, off: number) => {
    const t = reader.decode(huffDC[comp.dcTable]!);
    const diff = t ? extend(reader.receive(t), t) : 0;
    comp.pred += diff;
    comp.blockData[off] = comp.pred << al;
  };

  const decodeDCSuccessive = (comp: Component, off: number) => {
    comp.blockData[off] |= reader.bit() << al;
  };

  const decodeACFirst = (comp: Component, off: number) => {
    if (eobrun > 0) {
      eobrun--;
      return;
    }
    const ac = huffAC[comp.acTable]!;
    let k = ss;
    while (k <= se) {
      const rs = reader.decode(ac);
      const r = rs >> 4;
      const s = rs & 15;
      if (s === 0) {
        if (r < 15) {
          eobrun = (1 << r) + reader.receive(r) - 1;
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      if (k > se) break;
      comp.blockData[off + ZIGZAG[k]] = extend(reader.receive(s), s) * (1 << al);
      k++;
    }
  };

  const decodeACSuccessive = (comp: Component, off: number) => {
    const ac = huffAC[comp.acTable]!;
    let k = ss;
    const bit = 1 << al;
    if (eobrun > 0) {
      eobrun--;
      // Apply correction bits to already-nonzero coefficients in the band.
      for (; k <= se; k++) {
        const z = off + ZIGZAG[k];
        if (comp.blockData[z] !== 0) {
          if (reader.bit()) {
            if ((comp.blockData[z] & bit) === 0) {
              comp.blockData[z] += comp.blockData[z] > 0 ? bit : -bit;
            }
          }
        }
      }
      return;
    }
    while (k <= se) {
      const rs = reader.decode(ac);
      let r = rs >> 4;
      const s = rs & 15;
      let value = 0;
      if (s === 0) {
        if (r < 15) {
          eobrun = (1 << r) + reader.receive(r);
          break;
        }
        // r === 15: run of 16 zeros (but skip already-nonzero with correction).
      } else {
        // s must be 1 in successive AC; sign from one bit.
        value = reader.bit() ? bit : -bit;
      }
      // Advance over r zero coefficients, applying correction bits to nonzeros.
      while (k <= se) {
        const z = off + ZIGZAG[k];
        if (comp.blockData[z] !== 0) {
          if (reader.bit()) {
            if ((comp.blockData[z] & bit) === 0) {
              comp.blockData[z] += comp.blockData[z] > 0 ? bit : -bit;
            }
          }
        } else {
          if (r === 0) {
            if (value !== 0) comp.blockData[z] = value;
            k++;
            break;
          }
          r--;
        }
        k++;
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k++) {
        const z = off + ZIGZAG[k];
        if (comp.blockData[z] !== 0) {
          if (reader.bit()) {
            if ((comp.blockData[z] & bit) === 0) {
              comp.blockData[z] += comp.blockData[z] > 0 ? bit : -bit;
            }
          }
        }
      }
      eobrun--;
    }
  };

  let decodeFn: (comp: Component, off: number) => void;
  if (!progressive) decodeFn = decodeBaselineBlock;
  else if (ss === 0) decodeFn = ah === 0 ? decodeDCFirst : decodeDCSuccessive;
  else decodeFn = ah === 0 ? decodeACFirst : decodeACSuccessive;

  const blockOffset = (comp: Component, row: number, col: number) =>
    (row * comp.blocksPerLineForMcu + col) * 64;

  let mcu = 0;
  const interleaved = scanComponents.length > 1;
  const mcuCount = interleaved
    ? mcusPerLine * mcusPerColumn
    : scanComponents[0].blocksPerLine * scanComponents[0].blocksPerColumn;
  const restart = restartInterval || mcuCount;

  while (mcu < mcuCount) {
    const end = Math.min(mcu + restart, mcuCount);
    for (; mcu < end; mcu++) {
      if (interleaved) {
        const mcuRow = Math.floor(mcu / mcusPerLine);
        const mcuCol = mcu % mcusPerLine;
        for (const comp of scanComponents) {
          for (let v = 0; v < comp.v; v++) {
            for (let h = 0; h < comp.h; h++) {
              decodeFn(comp, blockOffset(comp, mcuRow * comp.v + v, mcuCol * comp.h + h));
            }
          }
        }
      } else {
        const comp = scanComponents[0];
        const row = Math.floor(mcu / comp.blocksPerLine);
        const col = mcu % comp.blocksPerLine;
        decodeFn(comp, blockOffset(comp, row, col));
      }
    }
    // Restart: align to the marker and reset predictors + eobrun.
    reader.reset();
    eobrun = 0;
    while (reader.pos + 1 < buf.length && !(buf[reader.pos] === 0xff && buf[reader.pos + 1] >= 0xd0 && buf[reader.pos + 1] <= 0xd7)) {
      if (buf[reader.pos] === 0xff && buf[reader.pos + 1] !== 0x00 && !(buf[reader.pos + 1] >= 0xd0 && buf[reader.pos + 1] <= 0xd7)) break;
      reader.pos++;
    }
    if (buf[reader.pos] === 0xff && buf[reader.pos + 1] >= 0xd0 && buf[reader.pos + 1] <= 0xd7) {
      reader.pos += 2;
      for (const c of scanComponents) c.pred = 0;
    }
  }

  // Advance past the entropy data to the next marker.
  let p = reader.pos;
  while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7))) {
    p++;
  }
  return p;
}

function reconstruct(
  buf: Buffer,
  width: number,
  height: number,
  components: Component[],
  quant: (Int32Array | null)[],
  hMax: number,
  vMax: number,
): RawImage {
  // Dequantize + IDCT every block into per-component sample planes.
  for (const comp of components) {
    const qt = quant[comp.quantId]!;
    const naturalQuant = new Int32Array(64);
    for (let k = 0; k < 64; k++) naturalQuant[ZIGZAG[k]] = qt[k];
    const planeW = comp.blocksPerLineForMcu * 8;
    const planeH = comp.blocksPerColumnForMcu * 8;
    const plane = new Uint8ClampedArray(planeW * planeH);
    const block = new Float64Array(64);
    const spatial = new Int16Array(64);
    for (let by = 0; by < comp.blocksPerColumnForMcu; by++) {
      for (let bx = 0; bx < comp.blocksPerLineForMcu; bx++) {
        const off = (by * comp.blocksPerLineForMcu + bx) * 64;
        for (let i = 0; i < 64; i++) block[i] = comp.blockData[off + i] * naturalQuant[i];
        idct8x8(block, spatial);
        for (let yy = 0; yy < 8; yy++) {
          const py = by * 8 + yy;
          const rowBase = py * planeW + bx * 8;
          for (let xx = 0; xx < 8; xx++) plane[rowBase + xx] = spatial[yy * 8 + xx];
        }
      }
    }
    (comp as Component & { plane?: Uint8ClampedArray; planeW?: number }).plane = plane;
    (comp as Component & { planeW?: number }).planeW = planeW;
  }

  const out = Buffer.alloc(width * height * 4);
  const single = components.length === 1;
  const planeOf = (c: Component) => (c as Component & { plane: Uint8ClampedArray }).plane;
  const pwOf = (c: Component) => (c as Component & { planeW: number }).planeW;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (single) {
        const c = components[0];
        const v = planeOf(c)[y * pwOf(c) + x];
        out[di] = out[di + 1] = out[di + 2] = v;
        out[di + 3] = 255;
        continue;
      }
      const sample = (c: Component) => {
        const sx = Math.floor((x * c.h) / hMax);
        const sy = Math.floor((y * c.v) / vMax);
        return planeOf(c)[sy * pwOf(c) + sx];
      };
      const Y = sample(components[0]);
      const Cb = sample(components[1]) - 128;
      const Cr = sample(components[2]) - 128;
      const r = Y + 1.402 * Cr;
      const g = Y - 0.344136 * Cb - 0.714136 * Cr;
      const b = Y + 1.772 * Cb;
      out[di] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      out[di + 3] = 255;
    }
  }

  return { width, height, data: out };
}
