// Loops of async functions in which one arm awaits: what stands before and after the arm, what leaves, continues, throws and returns there, beside other jobs.
// STATISTIC: UnrolledLoopsEmitted >= 20
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : String(v));
const message = (e: any): string => (e instanceof TypeError ? "TypeError" : String(e?.message ?? e));
async function soon(v: any): Promise<any> { await null; return v; }
async function fails(v: any, at: any): Promise<any> { await null; if (v === at) throw new Error("fails " + String(v)); return v; }
async function ticks(name: string, n: number): Promise<void> { for (let i = 0; i < n; i++) { log(name + i); await null; } }
const LIST: number[] = []; for (let k = 0; k < 60; k++) LIST.push((k * 3) & 127);
let total = 0;
async function listSum(stop: number): Promise<any> { let s = 0; for (let k = 0; k < LIST.length; k++) { s += LIST[k]; if (k === stop) await null; } return s; }
async function tail(xs: number[], stop: number): Promise<any> { let s = 0, n = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) { log("in " + show(s)); await soon(1); } n++; s -= n & 1; total += 1; } return [s, n]; }
async function alone(xs: number[], stop: number): Promise<any> { let i = 0; for (; i < xs.length; i++) if (xs[i] === stop) await null; return i; }
async function whiles(xs: number[], stop: number): Promise<any> { let i = -1, s = 0; while (++i < xs.length) { if (i === stop) { s += await soon(xs[i]); continue; } s += xs[i] * 2; } return [i, s]; }
async function whileAtEnd(xs: number[], stop: number): Promise<any> { let i = 0, s = 0; while (i < xs.length) { s += xs[i]; if (xs[i] === stop) await null; i++; } return [i, s]; }
async function elses(xs: number[], stop: number): Promise<any> { let a = 0, b = 0; for (let i = 0; i < xs.length; i++) { if (xs[i] > stop) { await null; a++; } else { b += xs[i]; } if (b > 20) break; b++; } return [a, b]; }
async function continues(xs: number[], stop: number): Promise<any> { let s = 0, n = 0; for (let i = 0; i < xs.length; i++) { if (i === stop) { n++; if (n > 1) continue; await null; if (xs[i] > 2) continue; s += 100; } if (xs[i] === 3) continue; s += xs[i]; } return [s, n]; }
async function leaves(xs: number[], stop: number): Promise<any> { let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) { await null; if (xs[i] === 2) return "returned " + s; if (xs[i] === 4) break; } if (s > 30) return "long " + s; s++; } return s; }
async function throws(xs: number[], stop: number): Promise<any> { let s = 0, n = 0; try { for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) n += await fails(xs[i], 4); n++; } } catch (e) { log(message(e) + show([s, n])); } finally { log("finally " + show([s, n])); } return [s, n]; }
async function tries(xs: number[], stop: number): Promise<any> { let s = 0; for (let i = 0; i < xs.length; i++) { if (i >= stop) { try { s += await fails(xs[i], 3); } catch (e) { log(message(e)); s = -s; } finally { s++; } } s += i; } return s; }
async function nested(xs: number[], stop: number): Promise<any> { let s = 0; outer: for (let j = 0; j < 3; j++) { for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) { await null; if (j === 1) continue outer; } s++; } s *= 2; } return s; }
async function grows(xs: number[], stop: number): Promise<any> { let s = 0; for (let i = 0; i < xs.length && i < 30; i++) { s += xs[i]; if (i === stop) { await null; xs.push(0.5, 7); } if (i === stop + 1) xs[0] = -0; s += xs[0]; } return [s, xs.length]; }
async function shrinks(xs: any, stop: number): Promise<any> { let s: any = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) { xs.length = 3; xs[2] = "string"; await null; } } return s; }
async function inside(xs: number[], stop: number): Promise<any> { let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i === stop) { for (let k = 0; k < 3; k++) s += await soon(k); } } return s; }
async function between(xs: number[], stop: number): Promise<any> { const start = total; let s = 0; for (let i = 0; i < xs.length; i++) { s += total - start; if (i === stop) { queueMicrotask(() => { total += 10; }); await null; } total++; } return s; }
async function twice(xs: number[], stop: number): Promise<any> { let s = 0; for (let i = 0; i < xs.length; i++) { if (i === stop) await null; s += xs[i]; if (xs[i] === stop) await soon(i); s++; } return s; }
async function closes(xs: number[], stop: number): Promise<any> { const later: (() => number)[] = []; for (let i = 0; i < xs.length; i++) { later.push(() => i * xs[i]); if (i === stop) await null; } return later.map(f => f()); }
const runs = [tail, alone, whiles, whileAtEnd, elses, continues, leaves, throws, tries, nested, grows, shrinks, inside, between, twice, closes];
const kinds: (() => any)[] = [() => [1, 2, 3, 4, 5], () => [], () => [0.5, 1.5, 2.5, 4], () => [2147483647, 1, -2147483648, 5], () => [-0, 0, 3], () => Array.from({ length: 24 }, (_, i) => i % 7), () => ["1", "x", "4"], () => [1, , 3]];
async function main() {
  for (const stop of [-1, 0, 1, 30, 59, 60]) log(show(await Promise.all([listSum(stop), ticks("l", 3)])));
  for (let round = 0; round < 3; round++)
    for (let r = 0; r < runs.length; r++)
      for (let k = 0; k < kinds.length; k++)
        for (const stop of [-1, 0, 1, 2, 3, 4]) {
          log(`-- ${r} ${k} ${stop}`);
          const beside = ticks("t", round * 2);
          try { log(show(await runs[r](kinds[k](), stop))); } catch (e) { log("threw " + message(e)); }
          await beside;
        }
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 97 === 0 || i < 40).join("\n"));
