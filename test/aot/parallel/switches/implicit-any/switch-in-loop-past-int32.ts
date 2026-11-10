// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// The bounds of the loop cross 2 ** 31, and another function loops over the same kinds of values in a generator. The build stopped.
function veil(value: any): any { return JSON.parse("0", () => value); }
function run(f: any, a: any, d: any, e: any): any { let v; try { v = f(a, d, e); } catch (x) { v = "threw"; } return v; }
function* y10(a: any, t: number, d: any, e: any): any { let i = d; while (a[i] !== t && i < e) { yield i; i++; } }
function k10(a: any, t: number, d: any, e: any): any { const it = y10(a, t, d, e); return typeof it; }
function k12(a: any, d: any, e: any): any { let c = 0; let i = d; while (i < e) { switch (a[i]) { case 0: c++; } i += 1; } return c + "/" + (i - 2 ** 31); }
for (let r = 0; r < 2; r++) { console.log(k10(JSON.parse("[32,0,10]"), 2.5, "0", 42)); console.log(run(k12, veil(new Uint8Array([49, 0, 42])), 2 ** 31 - 8, 2 ** 31 + 4)); }
