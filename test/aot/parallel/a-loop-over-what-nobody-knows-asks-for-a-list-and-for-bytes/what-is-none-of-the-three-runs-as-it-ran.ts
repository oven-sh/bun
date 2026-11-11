// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 1
// STATISTIC: IterationRestartsEmitted >= 7
// The table is a Uint32Array in a static field that may as well hold a value from elsewhere: nothing is expected of it, and it is none of the three that the front asks for. It gets a copy of its own, walked as the loop was walked before there was a front: the bytes are still read out of a view tested in front, eight turns at a time.
class Crc32 {
  private static readonly table: Uint32Array = (globalThis as any).tableMadeElsewhere ?? Crc32.build();
  private static build(): Uint32Array { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; }
  static of(b: Uint8Array, from: number, to: number): number { const t = Crc32.table; let c = 0xffffffff; for (let i = from; i < to; i++) c = t[(c ^ b[i]!) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
}
const bytes = new Uint8Array(300); for (let i = 0; i < 300; i++) bytes[i] = (i * 7) & 255;
let sum = 0; for (let t = 0; t < 50; t++) { bytes[0] = t; sum = (sum + Crc32.of(bytes, t & 3, 300 - (t & 7))) % 1000003; }
console.log(sum, Crc32.of(bytes, 0, 0), Crc32.of(bytes, 299, 301));
