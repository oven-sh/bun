// Under: --aot-harden=proof-checks: a generator is inlined into a loop that steps it; a loop of the generator under its own try gets a specialized version, and what the consumer carries has other names at joins inside that loop
// @ts-nocheck
const show: any = (v: any) => v && typeof v === "object" ? (Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, k) => k in v ? show(v[k]) : "hole") + "]" : "{" + Object.keys(v).map(k => k + ":" + show(v[k])) + "}") : String(v);
const fixed = [2, 4];
function* steps(xs: number[], ys: number[], all: any): any { let s: any = 0, c: any = 0, carried: any = all[0]; try { for (let i = 0; i < xs.length; i++) { try { try { for (const z of fixed) { c = z; c = z + 1; } ys[i] = i; } finally { c++; } } catch (e: any) { break; } } } catch (e: any) { s += 1000; } return s; }
function consume(xs: number[], ys: number[], all: any): any { const got: any = []; const it: any = steps(xs, ys, all); for (let k = 0; k < 30; k++) { const t = it.next(); got.push(t.value); if (t.done) break; } return got; }
{ const xs: any = [1, 2, 3], ys: any = new Float64Array([1, 2.5]), all: any = [[1]]; let answer: any; try { answer = show(consume(xs, ys, all)); } catch (e: any) { answer = "T"; } console.log(answer); }
export {};
