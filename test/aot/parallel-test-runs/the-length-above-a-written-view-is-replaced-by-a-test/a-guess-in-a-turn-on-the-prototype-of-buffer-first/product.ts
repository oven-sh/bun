export function total(bytes: Uint8Array): number { let n = 0, i = 0; while (i < bytes.length) { const c = bytes[i++]!; if (c >= 0xc2 && i < bytes.length) { n += bytes[i++]! & 0x3f; continue; } n += c; } return n; }
class Reader {
  at = 0; bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  turns(): number { let n = 0; for (this.at = 0; this.at < this.bytes.length; this.at++) n++; return n; }
}
export function turns(a: Uint8Array): number { return new Reader(a).turns(); }
export function loud(a: Uint8Array, heard: (at: number) => void): number { let s = 0, i = 0; while (i < a.length) { heard(i); s += a.length; i += 1 + (s & 0); } return s; }
