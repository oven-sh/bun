// Baseline (sequential DCT, Huffman) JPEG decoder, enough to back
// nativeImage.resize/crop for JPEG input. Progressive JPEGs (SOF2) and
// arithmetic coding are not supported (decode returns null); Chromium's
// Page.captureScreenshot(format:"jpeg") and typical photo assets are baseline.

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

class BitReader {
  private bitBuf = 0;
  private bitCnt = 0;
  marker = 0;

  constructor(private readonly data: Buffer, private pos: number) {}

  position(): number {
    return this.pos;
  }

  reset(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  bit(): number {
    if (this.bitCnt === 0) {
      if (this.pos >= this.data.length) return 0;
      let b = this.data[this.pos++];
      if (b === 0xff) {
        const next = this.data[this.pos] ?? 0;
        if (next === 0x00) {
          this.pos++; // stuffed byte
        } else {
          // Hit a marker; surface it and feed zero bits.
          this.marker = next;
          this.pos--; // leave 0xFF for the caller to resync
          b = 0;
        }
      }
      this.bitBuf = b;
      this.bitCnt = 8;
    }
    this.bitCnt--;
    return (this.bitBuf >> this.bitCnt) & 1;
  }

  receive(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
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

// Separable 8x8 inverse DCT (float; correctness over speed).
const IDCT_COS: number[][] = (() => {
  const t: number[][] = [];
  for (let u = 0; u < 8; u++) {
    t[u] = [];
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) {
      t[u][x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return t;
})();

function idct8x8(block: Float64Array, out: Int16Array): void {
  const tmp = new Float64Array(64);
  // rows
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += IDCT_COS[u][x] * block[y * 8 + u];
      tmp[y * 8 + x] = s * 0.5;
    }
  }
  // columns
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += IDCT_COS[v][y] * tmp[v * 8 + x];
      const val = Math.round(s * 0.5) + 128;
      out[y * 8 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
}

interface Component {
  id: number;
  h: number;
  v: number;
  quantId: number;
  dcTable: number;
  acTable: number;
  pred: number;
  plane: Int16Array;
  planeWidth: number;
  planeHeight: number;
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
  let baseline = false;

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1];
    pos += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = buf.readUInt16BE(pos);
    const segStart = pos + 2;
    const segEnd = pos + len;

    if (marker === 0xdb) {
      // DQT
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
    } else if (marker === 0xc0 || marker === 0xc1) {
      // SOF0 / SOF1 (baseline / extended sequential)
      baseline = true;
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
          plane: new Int16Array(0),
          planeWidth: 0,
          planeHeight: 0,
        });
        p += 3;
      }
    } else if (marker === 0xc2) {
      return null; // progressive — unsupported
    } else if (marker === 0xc4) {
      // DHT
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
    } else if (marker === 0xda) {
      // SOS
      if (!baseline) return null;
      const ns = buf[segStart];
      let p = segStart + 1;
      for (let i = 0; i < ns; i++) {
        const cs = buf[p];
        const comp = components.find((c) => c.id === cs);
        if (comp) {
          comp.dcTable = buf[p + 1] >> 4;
          comp.acTable = buf[p + 1] & 15;
        }
        p += 2;
      }
      pos = p + 3; // skip Ss, Se, Ah/Al
      return decodeScan(
        buf, pos, width, height, components, quant, huffDC, huffAC, restartInterval,
      );
    }
    pos = segEnd;
  }
  return null;
}

function decodeScan(
  buf: Buffer,
  pos: number,
  width: number,
  height: number,
  components: Component[],
  quant: (Int32Array | null)[],
  huffDC: (HuffTable | null)[],
  huffAC: (HuffTable | null)[],
  restartInterval: number,
): RawImage | null {
  const hMax = Math.max(...components.map((c) => c.h));
  const vMax = Math.max(...components.map((c) => c.v));
  const mcuW = 8 * hMax;
  const mcuH = 8 * vMax;
  const mcusPerLine = Math.ceil(width / mcuW);
  const mcusPerCol = Math.ceil(height / mcuH);

  for (const comp of components) {
    comp.planeWidth = mcusPerLine * comp.h * 8;
    comp.planeHeight = mcusPerCol * comp.v * 8;
    comp.plane = new Int16Array(comp.planeWidth * comp.planeHeight);
    comp.pred = 0;
  }

  const reader = new BitReader(buf, pos);
  const block = new Float64Array(64);
  const spatial = new Int16Array(64);
  let mcuCount = 0;

  for (let my = 0; my < mcusPerCol; my++) {
    for (let mx = 0; mx < mcusPerLine; mx++) {
      if (restartInterval > 0 && mcuCount > 0 && mcuCount % restartInterval === 0) {
        reader.reset();
        for (const c of components) c.pred = 0;
        // Skip the RSTn marker in the stream.
        let q = reader.position();
        while (q + 1 < buf.length && !(buf[q] === 0xff && buf[q + 1] >= 0xd0 && buf[q + 1] <= 0xd7)) q++;
        if (q + 1 < buf.length) (reader as unknown as { pos: number }).pos = q + 2;
      }
      for (const comp of components) {
        const dc = huffDC[comp.dcTable]!;
        const ac = huffAC[comp.acTable]!;
        const qt = quant[comp.quantId]!;
        for (let by = 0; by < comp.v; by++) {
          for (let bx = 0; bx < comp.h; bx++) {
            block.fill(0);
            const t = reader.decode(dc);
            const diff = t ? extend(reader.receive(t), t) : 0;
            comp.pred += diff;
            block[0] = comp.pred * qt[0];
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
              block[ZIGZAG[k]] = extend(reader.receive(s), s) * qt[k];
              k++;
            }
            idct8x8(block, spatial);
            const px0 = (mx * comp.h + bx) * 8;
            const py0 = (my * comp.v + by) * 8;
            for (let yy = 0; yy < 8; yy++) {
              const row = (py0 + yy) * comp.planeWidth + px0;
              for (let xx = 0; xx < 8; xx++) comp.plane[row + xx] = spatial[yy * 8 + xx];
            }
          }
        }
      }
      mcuCount++;
    }
  }

  const out = Buffer.alloc(width * height * 4);
  const single = components.length === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (single) {
        const c = components[0];
        const v = c.plane[y * c.planeWidth + x];
        out[di] = out[di + 1] = out[di + 2] = v;
        out[di + 3] = 255;
        continue;
      }
      const sample = (c: Component) => {
        const sx = Math.floor((x * c.h) / hMax);
        const sy = Math.floor((y * c.v) / vMax);
        return c.plane[sy * c.planeWidth + sx];
      };
      const Y = sample(components[0]);
      const Cb = sample(components[1]) - 128;
      const Cr = sample(components[2]) - 128;
      let r = Y + 1.402 * Cr;
      let g = Y - 0.344136 * Cb - 0.714136 * Cr;
      let b = Y + 1.772 * Cb;
      out[di] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      out[di + 3] = 255;
    }
  }

  return { width, height, data: out };
}
