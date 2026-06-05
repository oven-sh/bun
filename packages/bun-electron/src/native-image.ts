// nativeImage — Electron-compatible image wrapper. Stores encoded bytes
// (PNG/JPEG) and parses dimensions from the container headers; there is no
// raster pipeline (no resize/crop) yet.

import { existsSync, readFileSync } from "node:fs";

interface Size {
  width: number;
  height: number;
}

function pngSize(buf: Buffer): Size | null {
  // 8-byte signature, then IHDR: length(4) "IHDR"(4) width(4) height(4).
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): Size | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0..SOF15 except DHT(C4)/JPGA?(C8)/DAC(CC) carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
}

export class NativeImage {
  private readonly bytes: Buffer;
  private readonly size: Size;

  constructor(bytes: Buffer = Buffer.alloc(0)) {
    this.bytes = bytes;
    this.size = pngSize(bytes) ?? jpegSize(bytes) ?? { width: 0, height: 0 };
  }

  static createEmpty(): NativeImage {
    return new NativeImage();
  }

  static createFromBuffer(buffer: Buffer | Uint8Array): NativeImage {
    if (!(buffer instanceof Uint8Array)) {
      throw new TypeError("buffer must be a node Buffer");
    }
    return new NativeImage(Buffer.from(buffer));
  }

  static createFromPath(path: string): NativeImage {
    // Electron returns an empty image for unreadable paths.
    if (!existsSync(path)) return NativeImage.createEmpty();
    try {
      return new NativeImage(readFileSync(path));
    } catch {
      return NativeImage.createEmpty();
    }
  }

  static createFromDataURL(dataURL: string): NativeImage {
    const match = /^data:image\/[a-z+.-]+;base64,(.*)$/i.exec(dataURL);
    if (!match) return NativeImage.createEmpty();
    return new NativeImage(Buffer.from(match[1], "base64"));
  }

  toPNG(): Buffer {
    return this.bytes;
  }

  toDataURL(): string {
    const mime = jpegSize(this.bytes) ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${this.bytes.toString("base64")}`;
  }

  getSize(): Size {
    return { ...this.size };
  }

  getAspectRatio(): number {
    return this.size.height === 0 ? 1 : this.size.width / this.size.height;
  }

  isEmpty(): boolean {
    return this.bytes.length === 0;
  }
}

export const nativeImage = {
  createEmpty: NativeImage.createEmpty,
  createFromBuffer: NativeImage.createFromBuffer,
  createFromPath: NativeImage.createFromPath,
  createFromDataURL: NativeImage.createFromDataURL,
};
