// for-of loops of async functions in which some iterations await: arrays of every kind, iterables that count their steps and closes, arms that leave, continue, throw and change the array, beside other jobs.
// STATISTIC: IterationRestartsEmitted >= 6
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
const message = (e: any): string => (e instanceof TypeError ? "TypeError" : String(e?.message ?? e));
async function soon(v: any): Promise<any> { await null; return v; }
async function fails(v: any, at: any): Promise<any> { await null; if (v === at) throw new Error("fails " + String(v)); return v; }
async function ticks(name: string, n: number): Promise<void> { for (let i = 0; i < n; i++) { log(name + i); await null; } }
const counted = (values: any[]) => ({ [Symbol.iterator]() { let at = 0; return { next() { log("next " + at); return at < values.length ? { done: false, value: values[at++] } : { done: true, value: undefined }; }, return() { log("closed at " + at); return {}; } }; } });
const LIST: number[] = []; for (let k = 0; k < 60; k++) LIST.push((k * 3) & 127);
async function listSum(stop: number): Promise<any> { let s = 0; for (const x of LIST) { s += x; if (x === stop) await null; } return s; }
async function sums(xs: number[], stop: number): Promise<any> { let s = 0, n = 0; for (const x of xs) { s += x; if (n === stop) { log("in " + show(s)); await soon(1); } n++; s -= n & 1; } return [s, n]; }
async function records(xs: { n: number; t: string }[], stop: number): Promise<any> { let s = 0, t = ""; for (const x of xs) { s += x.n + x.t.length; if (x.n === stop) { t += await soon(x.t); } } return [s, t]; }
async function texts(xs: string[], stop: string): Promise<any> { let s = 0; for (const x of xs) { s += x.length; if (x === stop) await null; } return s; }
async function elses(xs: number[], stop: number): Promise<any> { let a = 0, b = 0; for (const x of xs) { if (x > stop) { await null; a++; continue; } else { b += x; } if (b > 20) break; b++; } return [a, b]; }
async function leaves(xs: any, stop: number): Promise<any> { let s = 0, i = 0; for (const x of xs) { s += x; if (i++ === stop) { await null; if (x === 2) return "returned " + s; if (x === 4) break; } if (s > 30) return "long " + s; s++; } return s; }
async function throws(xs: any, stop: number): Promise<any> { let s = 0, n = 0; try { for (const x of xs) { s += x; if (n === stop) n += await fails(x, 4); n++; } } catch (e) { log(message(e) + show([s, n])); } finally { log("finally " + show([s, n])); } return [s, n]; }
async function tries(xs: any, stop: number): Promise<any> { let s = 0, i = 0; for (const x of xs) { if (i++ >= stop) { try { s += await fails(x, 3); } catch (e) { log(message(e)); s = -s; } finally { s++; } } s += x; } return s; }
async function nested(xs: any, stop: number): Promise<any> { let s = 0; outer: for (let j = 0; j < 3; j++) { let i = 0; for (const x of xs) { s += x; if (i++ === stop) { await null; if (j === 1) continue outer; } s++; } s *= 2; } return s; }
async function grows(xs: number[], stop: number): Promise<any> { let s = 0, i = 0; for (const x of xs) { s += x; if (i === stop) { await null; xs.push(0.5, 7); } if (++i > 30) break; if (i === stop + 2) xs[i] = -0; s += xs[0]; } return [s, xs.length]; }
async function shrinks(xs: any, stop: number): Promise<any> { let s: any = 0, i = 0; for (const x of xs) { s += x; if (i++ === stop) { xs.length = 3; xs[2] = "string"; await null; } } return s; }
async function stores(xs: number[], stop: number): Promise<any> { let i = 0; const to: number[] = []; for (const x of xs) { to[i] = x * 2; if (i++ === stop) { await null; to[0] = 9; } to[0] += 1; } return to; }
async function calls(xs: any, stop: number): Promise<any> { let s = 0, i = 0; for (const x of xs) { if (i === 1) log("call " + show(x)); s += x; if (i++ === stop) s += await soon(i); } return s; }
async function pairs(stop: number): Promise<any> { let s = 0; for (const [k, v] of new Map([[1, 2], [2, 4], [3, 8], [4, 0.5]])) { s += k * v; if (k === stop) await null; } for (const v of new Set([1, 2, 3])) { if (v === stop) await null; s += v; } return s; }
async function* yields(xs: any, stop: number): AsyncGenerator<any> { let s = 0, i = 0; for (const x of xs) { s += x; if (i === stop) { await null; } if (i++ === stop + 1) yield s; } yield "end " + s; }
async function consumes(xs: any, stop: number): Promise<any> { const all: any[] = []; for await (const v of yields(xs, stop)) all.push(v); return all; }
const runs: ((xs: any, stop: any) => Promise<any>)[] = [sums, elses, leaves, throws, tries, nested, grows, shrinks, stores, calls, consumes];
const kinds: (() => any)[] = [() => [1, 2, 3, 4, 5], () => [], () => [0.5, 1.5, 2.5, 4], () => [2147483647, 1, -2147483648, 5], () => [-0, 0, 3], () => Array.from({ length: 24 }, (_, i) => i % 7), () => ["1", "x", "4"], () => [1, , 3], () => counted([1, 2, 3, 4, 5]), () => new Set([1, 2, 3]), () => new Uint8Array([4, 5, 6]), () => "1234"];
async function main() {
  for (let round = 0; round < 3; round++) {
    for (const stop of [-1, 0, 3, 90, 177 & 127]) log(show(await Promise.all([listSum(stop), ticks("l", 3)])));
    for (const stop of [-1, 1, 5]) { log(show(await records([{ n: 1, t: "a" }, { n: 5, t: "bc" }, { n: 0.5, t: "" }], stop))); log(show(await texts(["w1", "w" + stop, "w3"], "w5"))); log(show(await pairs(stop))); }
    for (let r = 0; r < runs.length; r++)
      for (let k = 0; k < kinds.length; k++)
        for (const stop of [-1, 0, 1, 3]) {
          log(`-- ${r} ${k} ${stop}`);
          const beside = ticks("t", round * 2);
          try { log(show(await runs[r](kinds[k](), stop))); } catch (e) { log("threw " + message(e)); }
          await beside;
        }
  }
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 97 === 0 || i < 40).join("\n"));
