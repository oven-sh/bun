// Minimal PROGRESSIVE JPEG encoder — test infrastructure only (no external
// JPEG encoder exists in this environment). Emits a single-component
// (grayscale) progressive JPEG: SOF2 with a DC scan (Ss=0,Se=0) and an AC
// scan (Ss=1,Se=63), spectral selection, no successive approximation. This is
// just enough to produce a genuinely progressive bitstream to exercise the
// decoder's multi-scan accumulation path.

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

// Standard JPEG luminance Huffman tables (Annex K).
const DC_BITS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
// prettier-ignore
const AC_VALS = [
  0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
  0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,
  0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,
  0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
  0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
  0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
  0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,
  0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,
  0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,
  0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
  0xf9,0xfa,
];

function buildCodes(bits: number[], vals: number[]): Map<number, { code: number; len: number }> {
  const map = new Map<number, { code: number; len: number }>();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len]; i++) {
      map.set(vals[k++], { code, len });
      code++;
    }
    code <<= 1;
  }
  return map;
}

class BitWriter {
  bytes: number[] = [];
  private acc = 0;
  private nbits = 0;
  write(code: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.nbits++;
      if (this.nbits === 8) {
        this.bytes.push(this.acc & 0xff);
        if ((this.acc & 0xff) === 0xff) this.bytes.push(0x00); // stuff
        this.acc = 0;
        this.nbits = 0;
      }
    }
  }
  flush(): void {
    if (this.nbits > 0) {
      this.acc = (this.acc << (8 - this.nbits)) | ((1 << (8 - this.nbits)) - 1);
      this.bytes.push(this.acc & 0xff);
      if ((this.acc & 0xff) === 0xff) this.bytes.push(0x00);
      this.acc = 0;
      this.nbits = 0;
    }
  }
}

const FDCT_COS: number[][] = (() => {
  const t: number[][] = [];
  for (let u = 0; u < 8; u++) {
    t[u] = [];
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) t[u][x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return t;
})();

function fdct(block: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let n = 0; n < 8; n++) s += FDCT_COS[u][n] * block[x * 8 + n];
      tmp[x * 8 + u] = s * 0.5;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let n = 0; n < 8; n++) s += FDCT_COS[v][n] * tmp[n * 8 + y];
      out[v * 8 + y] = s * 0.5;
    }
  }
}

function magnitude(v: number): number {
  let n = 0;
  let a = Math.abs(v);
  while (a > 0) {
    a >>= 1;
    n++;
  }
  return n;
}

function bitsFor(v: number, size: number): number {
  return v < 0 ? (v - 1) & ((1 << size) - 1) : v;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

/** Encodes a grayscale RawImage-like (width,height,data=gray bytes) to a
 * progressive JPEG buffer. Quantization is 1 (lossless DCT round-trip within
 * IDCT rounding) so the decode round-trip is near-exact. */
export function encodeProgressiveGrayscale(
  width: number,
  height: number,
  gray: Uint8Array,
): Buffer {
  const dcCodes = buildCodes(DC_BITS, DC_VALS);
  const acCodes = buildCodes(AC_BITS, AC_VALS);
  const bw = Math.ceil(width / 8);
  const bh = Math.ceil(height / 8);

  // Forward-transform all blocks; store quantized (q=1) coefficients.
  const coeffs: Int32Array[] = [];
  const blk = new Float64Array(64);
  const dct = new Float64Array(64);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let yy = 0; yy < 8; yy++) {
        const sy = Math.min(height - 1, by * 8 + yy);
        for (let xx = 0; xx < 8; xx++) {
          const sx = Math.min(width - 1, bx * 8 + xx);
          blk[yy * 8 + xx] = gray[sy * width + sx] - 128;
        }
      }
      fdct(blk, dct);
      const c = new Int32Array(64);
      for (let i = 0; i < 64; i++) c[i] = Math.round(dct[i]);
      coeffs.push(c);
    }
  }

  // DC scan (Ss=0,Se=0): differential DC.
  const dcWriter = new BitWriter();
  let pred = 0;
  for (const c of coeffs) {
    const diff = c[0] - pred;
    pred = c[0];
    const size = magnitude(diff);
    const sym = dcCodes.get(size)!;
    dcWriter.write(sym.code, sym.len);
    if (size > 0) dcWriter.write(bitsFor(diff, size), size);
  }
  dcWriter.flush();

  // AC scan (Ss=1,Se=63): run-length + EOB, no EOB-run (EOB per block).
  const acWriter = new BitWriter();
  for (const c of coeffs) {
    let run = 0;
    for (let k = 1; k <= 63; k++) {
      const v = c[ZIGZAG[k]];
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        const zrl = acCodes.get(0xf0)!;
        acWriter.write(zrl.code, zrl.len);
        run -= 16;
      }
      const size = magnitude(v);
      const sym = acCodes.get((run << 4) | size)!;
      acWriter.write(sym.code, sym.len);
      acWriter.write(bitsFor(v, size), size);
      run = 0;
    }
    const eob = acCodes.get(0x00)!;
    acWriter.write(eob.code, eob.len);
  }
  acWriter.flush();

  const out: number[] = [];
  out.push(0xff, 0xd8); // SOI
  // DQT (all 1s)
  out.push(0xff, 0xdb, ...u16(67), 0x00);
  for (let i = 0; i < 64; i++) out.push(1);
  // SOF2 (progressive), 1 component, sampling 1x1, quant 0
  out.push(0xff, 0xc2, ...u16(11), 8, ...u16(height), ...u16(width), 1, 1, 0x11, 0);
  // DHT DC
  out.push(0xff, 0xc4, ...u16(2 + 1 + 16 + DC_VALS.length), 0x00, ...DC_BITS.slice(1), ...DC_VALS);
  // DHT AC
  out.push(0xff, 0xc4, ...u16(2 + 1 + 16 + AC_VALS.length), 0x10, ...AC_BITS.slice(1), ...AC_VALS);
  // SOS DC scan: 1 comp (id1, dc table 0), Ss=0 Se=0 Ah=0 Al=0
  out.push(0xff, 0xda, ...u16(8), 1, 1, 0x00, 0, 0, 0x00, ...dcWriter.bytes);
  // SOS AC scan: 1 comp (id1, ac table 0), Ss=1 Se=63 Ah=0 Al=0
  out.push(0xff, 0xda, ...u16(8), 1, 1, 0x00, 1, 63, 0x00, ...acWriter.bytes);
  out.push(0xff, 0xd9); // EOI
  return Buffer.from(out);
}
