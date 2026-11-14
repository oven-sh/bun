const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
function sumTo(n: number): number { let s = 0; for (let i = 0; i <= n; i++) s += i; return s; }
function sumSquares(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += i * i; return s; }
function past31(): number[] { const r: number[] = []; for (let i = 2147483645; i < 2147483651; i++) r.push(i); return r; }
function down(): number[] { const r: number[] = []; for (let i = -2147483646; i > -2147483651; i--) r.push(i); return r; }
function step(): number[] { const r: number[] = []; for (let i = 0; i < 5e9; i += 1e9) r.push(i); return r; }
function doubling(): number[] { const r: number[] = []; for (let i = 1; i < 1e20; i *= 1000) r.push(i); return r; }
function halves(): number[] { const r: number[] = []; for (let i = 10; i > 0.5; i /= 2) r.push(i); return r; }
function wrap(): number[] { let x = 2147483647; const r: number[] = []; x++; r.push(x); x = 2147483647; x = (x + 1) | 0; r.push(x); let y = -2147483648; y--; r.push(y); let z = 65536; z *= z; r.push(z); z *= z; r.push(z); let u = 0; u -= 1; r.push(u >>> 0); return r; }
function product(n: number): number { let p = 1; for (let i = 1; i <= n; i++) p *= i; return p; }
function index(a: number[]): number[] { const r: number[] = []; for (let i = a.length - 1; i >= -1; i--) r.push(a[i] as number); return r; }
function lengths(): number[] { const a: number[] = []; a[4294967294] = 1; const b: number[] = [1, 2, 3]; b.length = 1; return [a.length, b.length, b[1] as number]; }
function run(): unknown { return [sumTo(100000), sumSquares(3000), sumSquares(100000), past31(), down(), step(), doubling(), halves(), wrap(), product(12), product(13), product(25), index([1, 2]), lengths()]; }
for (const x of run() as unknown[]) console.log(show(x));
