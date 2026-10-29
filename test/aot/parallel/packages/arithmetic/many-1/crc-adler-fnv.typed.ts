const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
function crc32(bytes: number[]): number { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } let crc = 0xffffffff; for (const b of bytes) crc = t[(crc ^ b) & 255]! ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function adler32(bytes: number[]): number { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function fnv1a(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function fnvByShifts(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return h >>> 0; }
function djb2(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return h >>> 0; }
function java(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (31 * h + s.charCodeAt(i)) | 0; return h; }
function unbounded(s: string): number { let h = 7; for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); return h; }
function run(): unknown { const s = "The quick brown fox jumps over the lazy dog".repeat(3); const b = Array.from(s, (c) => c.charCodeAt(0)); return [crc32(b), adler32(b), fnv1a(s), fnvByShifts(s), djb2(s), java(s), unbounded(s), unbounded(s) % 1000003]; }
for (const x of run() as unknown[]) console.log(show(x));
