const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
function sha256(bytes: number[]): string {
  const k: number[] = []; const h: number[] = []; let n = 2;
  const frac = (x: number): number => ((x - Math.floor(x)) * 4294967296) | 0;
  while (k.length < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { if (h.length < 8) h.push(frac(Math.pow(n, 1 / 2))); k.push(frac(Math.pow(n, 1 / 3))); } n++; }
  const m = bytes.slice(); const bits = bytes.length * 8; m.push(0x80); while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255);
  const w: number[] = new Array(64).fill(0); const rotr = (x: number, r: number): number => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4]! << 24) | (m[o + i * 4 + 1]! << 16) | (m[o + i * 4 + 2]! << 8) | m[o + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0; }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) { const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) | 0; const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0; h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function run(): unknown { const b = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0)); return [sha256([]), sha256(b("abc")), sha256(b("a".repeat(200)))]; }
for (const x of run() as unknown[]) console.log(show(x));
