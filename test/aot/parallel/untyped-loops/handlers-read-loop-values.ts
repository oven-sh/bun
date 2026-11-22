// Loops over arrays inside try blocks whose catch or finally reads what the loop counts, sums and keeps. The loop stops at every place, over arrays of every kind.
// STATISTIC: IterationRestartsEmitted >= 8
// STATISTIC: UnrolledLoopsWithReentry >= 1
const out: string[] = [];
const log = (word: unknown) => { out.push(String(word)); };
const show = (v: any): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v + ":" + String(v));
const message = (e: any): string => (e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : String(e?.message ?? e));
function check(x: any, stop: any): void { if (x === stop) throw new Error("check " + String(x)); }
async function soon(v: any): Promise<any> { await null; return v; }
const throwing = { valueOf() { throw new RangeError("no number"); } };
function sums(xs: any, stop: any): any { let s = 0; try { for (let i = 0; i < xs.length; i++) { const x = xs[i]; s += x * 2; check(x, stop); s -= x; } return s; } finally { log("sum " + show(s)); } }
function fractions(xs: any, stop: any): any { let s = 0.5, n = 0; try { for (let i = 0; i < xs.length; i++) { s = s * 0.5 + xs[i]; if (xs[i] === stop) throw new Error("at " + i); n++; } } catch (e) { log(message(e) + show([s, n])); s += 1; } return [s, n]; }
function both(xs: any, stop: any): any { let s = 0, last: any; try { for (let i = xs.length - 1; i >= 0; i--) { last = xs[i]; s = (s * 31 + xs[i]) | 0; check(last, stop); } } catch (e) { log(message(e) + show([s, last])); s = -s; } finally { log("last " + show([last, s])); } return s; }
function moves(xs: any, stop: any): any { const to: any[] = []; let n = 0; try { for (let i = 0; i < xs.length; i++) { to[n++] = xs[i]; check(xs[i], stop); to[n++] = xs[i] + n; } } catch (e) { return show(to) + n + message(e); } finally { log("moved " + n); } return show(to) + n; }
function nested(xs: any, stop: any): any { let s = 0, n = 0; try { try { for (let i = 0; i < xs.length; i++) { s += xs[i]; n += i; check(xs[i], stop); } } finally { log("inner " + show([s, n])); n = -n; } } catch (e) { log("outer " + show([s, n]) + message(e)); } return s + n; }
function around(xs: any, stop: any): any { let s = 0, n = 0; for (let r = 0; r < 3; r++) { try { for (let i = r; i < xs.length; i++) { s += xs[i] * r; if (xs[i] === stop && r === 1) throw r; } n += 10; } catch (e) { log("round " + show(e) + show([s, n])); s = 0; } } return [s, n]; }
function leaves(xs: any, stop: any): any { let s = 0; try { for (let i = 0; i < xs.length; i++) { s += xs[i]; if (xs[i] === stop) { if (i & 1) return "left " + show(s); break; } if (xs[i] === 4) continue; s += 1; } } finally { if (s === 3) return "from finally"; log("left " + show(s)); } return s; }
function changes(xs: any, stop: any): any { let s = 0, n = 0; try { for (let i = 0; i < xs.length && i < 50; i++) { s += xs[i]; n++; if (xs[i] === stop) { if (i === 0) xs[1] = "string"; else if (i === 1) xs.length = 2; else if (i === 2) xs.push(1.5, stop); else throw new Error("end " + i); } } } catch (e) { log(message(e) + show([s, n])); } finally { log("count " + n); } return s; }
function loops(xs: any, stop: any): any { let s = 0; try { for (let j = 0; j < 2; j++) { for (let i = 0; i < xs.length; i++) { s += xs[i]; check(xs[i], stop); } s *= 3; } } catch (e) { for (let i = 0; i < xs.length; i++) { try { s += xs[i]; } catch { s += i; } } return "caught " + show(s); } return s; }
function grows(xs: any, stop: any): any { let text = "", n = 0; try { for (let i = 0; i < xs.length; i++) { n += xs[i] === stop ? 1 : 0; text += xs[i]; check(xs[i], stop); } } finally { log(text.length + " " + n + text.slice(-6)); } return text; }
function objects(xs: any, stop: any): any { const o = { s: 0, n: 0 }; let seen: any = null; try { for (let i = 0; i < xs.length; i++) { seen = { i, x: xs[i] }; o.s += xs[i] * 1.5; o.n++; check(xs[i], stop); } } catch (e) { return [o.s, o.n, seen.i, seen.x]; } return [o.s, o.n, seen && seen.i]; }
const LIST: number[] = []; for (let k = 0; k < 60; k++) LIST.push((k * 3) & 127);
const WORDS: string[] = []; for (let k = 0; k < 60; k++) WORDS.push("w" + k);
function listFinally(stop: number): number { let s = 0; try { for (let k = 0; k < LIST.length; k++) { s += LIST[k]; if (k === stop) throw new Error("stop " + k); } } finally { s++; log("list " + show(s)); } return s; }
function listCatch(stop: number): number { let s = 0.25, n = 0; try { for (let k = 0; k < LIST.length; k++) { s += LIST[k] * 0.5; n += LIST[k] & 1; if (LIST[k] === stop) throw k; } } catch (e) { return s - n + (e as number); } return s; }
function wordCount(list: string[], stop: number): string { let done = 0, s = 0; try { for (const x of list) { if (done === stop) throw new Error("empty"); s += x.length; done++; } } catch (e) { return message(e) + " " + done + " " + s; } finally { done = -1; } return done + " " + s; }
function recordSum(list: { n: number; t: string }[], stop: number): string { let s = 0; try { for (const x of list) { s += x.n + x.t.length; if (s > stop) throw s; } } catch (e) { s += (e as number) / 2; } finally { s++; } return show(s); }
function filled(list: number[], stop: number): string { let n = 0; try { for (let k = 0; k < list.length; k++) { list[k] = list[k] * 2 + n; n++; if (k === stop) list.length = 3; if (k === stop + 1) list[k + 1] = 0.5; if (n > 70) throw new RangeError("long"); } } finally { log("filled " + n + " " + list.slice(0, 5).map(show).join()); } return show(n); }
function typed(stop: any): void {
  for (const run of [() => listFinally(stop), () => listCatch(stop), () => wordCount(WORDS, stop), () => wordCount(WORDS.slice(0, 5), stop), () => recordSum(LIST.map(n => ({ n, t: "t" + n })), stop * 10), () => recordSum([{ n: 1, t: "a" }, { n: 0.5, t: "bc" }], stop), () => filled(LIST.slice(0, 9), stop), () => filled([0.5, 1, 2], stop)])
    try { log(show(run())); } catch (e) { log("typed " + message(e)); }
}
async function waits(xs: any, stop: any): Promise<any> { let s = 0, n = 0; try { for (let i = 0; i < xs.length; i++) { s += xs[i]; n++; if (i === 2) s += await soon(1); check(xs[i], stop); } } catch (e) { log(message(e) + show([s, n])); await null; s -= n; } finally { log("waited " + show([s, n])); } return s; }
function* yields(xs: any, stop: any): Generator<any> { let s = 0; try { for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i & 1) yield s; check(xs[i], stop); } } finally { log("yielded " + show(s)); yield "end"; } }
function* total(xs: any, stop: any): Generator<any> { let s = 0, n = 0; for (const v of yields(xs, stop)) { if (typeof v === "number") s += v; n++; if (n > 3) break; } return [s, n]; }
const runs: ((xs: any, stop: any) => any)[] = [sums, fractions, both, moves, nested, around, leaves, changes, loops, grows, objects, waits, (xs, stop) => total(xs, stop).next().value];
const kinds: (() => any)[] = [() => [1, 2, 3, 4, 5], () => [], () => [0.5, 1.5, 2.5, 4], () => [1, 2.5, 3, 5], () => [2147483647, 1, -2147483648, 5], () => [-0, 0, 3], () => ["1", "x", "4"], () => [1, , 3], () => [1, "x", null, 2], () => [1, 2n, 3], () => [1, throwing, 3], () => [{ n: 1 }, 2], () => new Uint8Array([1, 2, 3, 5]), () => new Float64Array([0.5, 1.5, 4]), () => "1234", () => ({ length: 3, 0: 1, 1: 2, 2: 4 }), () => Array.from({ length: 40 }, (_, i) => i % 7), () => null];
async function main() {
  for (let round = 0; round < 3; round++) for (const stop of [-1, 0, 1, 3, 7, 33, 59, 2.5, undefined]) typed(stop);
  for (let round = 0; round < 3; round++)
    for (let r = 0; r < runs.length; r++)
      for (let k = 0; k < kinds.length; k++)
        for (const stop of [undefined, 1, 2, 3, 2.5, 4, 5, "x"]) {
          try { log(`${r} ${k} ` + show(await runs[r](kinds[k](), stop))); } catch (e) { log(`${r} ${k} threw ` + message(e)); }
        }
}
await main();
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
if (process.argv[2] === "all") console.log(out.join("\n"));
else console.log(out.filter((_, i) => i % 97 === 0 || i < 40).join("\n"));
