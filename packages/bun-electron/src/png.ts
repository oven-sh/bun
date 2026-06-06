// Minimal PNG codec for nativeImage resize/crop. Supports 8-bit RGB and RGBA,
// non-interlaced — the common cases produced by capturePage and typical icon
// assets. Decoders/encoders for other color types are intentionally omitted;
// callers fall back to leaving the image unmodified.

import { inflateSync, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (PNG polynomial).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Number of samples per pixel for each PNG color type.
function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0: return 1; // grayscale
    case 2: return 3; // RGB
    case 3: return 1; // palette index
    case 4: return 2; // grayscale + alpha
    case 6: return 4; // RGBA
    default: return 0;
  }
}

// Unfilter one image pass and emit RGBA. `raw` holds filtered scanlines.
function unfilterToRGBA(
  raw: Buffer,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  palette: Buffer | null,
  trns: Buffer | null,
  out: Buffer,
  outWidth: number,
  destX: (i: number) => number,
  destY: (j: number) => number,
): void {
  const channels = channelsForColorType(colorType);
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // bytes/pixel for filtering
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let pos = 0;

  for (let j = 0; j < height; j++) {
    const filter = raw[pos++];
    raw.copy(cur, 0, pos, pos + stride);
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value = cur[x];
      switch (filter) {
        case 1: value += a; break;
        case 2: value += b; break;
        case 3: value += (a + b) >> 1; break;
        case 4: value += paeth(a, b, c); break;
      }
      cur[x] = value & 0xff;
    }

    const oy = destY(j);
    for (let i = 0; i < width; i++) {
      let r = 0, g = 0, b = 0, alpha = 255;
      // Read `channels` samples at bitDepth precision, scaled to 8-bit.
      const sample = (chan: number): number => {
        if (bitDepth === 16) return cur[(i * channels + chan) * 2]; // high byte
        if (bitDepth === 8) return cur[i * channels + chan];
        // sub-byte (1/2/4) — palette/grayscale only, single channel
        const bitsPerSample = bitDepth;
        const samplesPerByte = 8 / bitsPerSample;
        const byteIndex = Math.floor((i * channels + chan) / samplesPerByte);
        const within = (i * channels + chan) % samplesPerByte;
        const shift = 8 - bitsPerSample * (within + 1);
        const mask = (1 << bitsPerSample) - 1;
        return (cur[byteIndex] >> shift) & mask;
      };

      if (colorType === 0) {
        const max = (1 << (bitDepth === 16 ? 8 : bitDepth)) - 1;
        const v = bitDepth < 8 ? Math.round((sample(0) * 255) / max) : sample(0);
        r = g = b = v;
      } else if (colorType === 4) {
        r = g = b = sample(0);
        alpha = sample(1);
      } else if (colorType === 2) {
        r = sample(0); g = sample(1); b = sample(2);
      } else if (colorType === 6) {
        r = sample(0); g = sample(1); b = sample(2); alpha = sample(3);
      } else if (colorType === 3 && palette) {
        const idx = sample(0);
        r = palette[idx * 3];
        g = palette[idx * 3 + 1];
        b = palette[idx * 3 + 2];
        alpha = trns && idx < trns.length ? trns[idx] : 255;
      }

      const di = (oy * outWidth + destX(i)) * 4;
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = alpha;
    }
    cur.copy(prev);
  }
}

// Adam7 interlace pass geometry.
const ADAM7 = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
];

/**
 * Decode a PNG to RGBA. Supports color types 0/2/3/4/6, bit depths 1/2/4/8/16,
 * and Adam7 interlacing. Returns null only for malformed/non-PNG input.
 */
export function decodePNG(png: Buffer): RawImage | null {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
      interlace = png[dataStart + 12];
    } else if (type === "PLTE") {
      palette = png.subarray(dataStart, dataStart + length);
    } else if (type === "tRNS") {
      trns = png.subarray(dataStart, dataStart + length);
    } else if (type === "IDAT") {
      idat.push(png.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (channelsForColorType(colorType) === 0) return null;
  if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (colorType === 3 && !palette) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  const channels = channelsForColorType(colorType);

  if (interlace === 0) {
    unfilterToRGBA(raw, width, height, bitDepth, colorType, palette, trns, out, width,
      (i) => i, (j) => j);
  } else if (interlace === 1) {
    let pos = 0;
    for (const pass of ADAM7) {
      const pw = Math.ceil((width - pass.x0) / pass.dx);
      const ph = Math.ceil((height - pass.y0) / pass.dy);
      if (pw <= 0 || ph <= 0) continue;
      const bitsPerPixel = channels * bitDepth;
      const stride = Math.ceil((pw * bitsPerPixel) / 8);
      const passBytes = (stride + 1) * ph;
      const passRaw = raw.subarray(pos, pos + passBytes);
      pos += passBytes;
      unfilterToRGBA(passRaw, pw, ph, bitDepth, colorType, palette, trns, out, width,
        (i) => pass.x0 + i * pass.dx, (j) => pass.y0 + j * pass.dy);
    }
  } else {
    return null;
  }

  return { width, height, data: out };
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode an RGBA RawImage to an 8-bit RGBA PNG (filter type 0). */
export function encodePNG(image: RawImage): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  const rawWithFilters = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rawWithFilters[y * (stride + 1)] = 0; // filter: none
    data.copy(rawWithFilters, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rawWithFilters)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbor resize of an RGBA RawImage. */
export function resizeRaw(image: RawImage, width: number, height: number): RawImage {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const si = (sy * image.width + sx) * 4;
      const di = (y * width + x) * 4;
      image.data.copy(out, di, si, si + 4);
    }
  }
  return { width, height, data: out };
}

/** Crop an RGBA RawImage to a rectangle (clamped to bounds). */
export function cropRaw(image: RawImage, x: number, y: number, w: number, h: number): RawImage {
  const cx = Math.max(0, Math.min(x, image.width));
  const cy = Math.max(0, Math.min(y, image.height));
  const cw = Math.max(0, Math.min(w, image.width - cx));
  const ch = Math.max(0, Math.min(h, image.height - cy));
  const out = Buffer.alloc(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const si = ((cy + row) * image.width + cx) * 4;
    image.data.copy(out, row * cw * 4, si, si + cw * 4);
  }
  return { width: cw, height: ch, data: out };
}
