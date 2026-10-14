// A `throw` that is caught in the same function: values, locals, nested handlers, `finally` and loops behave as written.
declare const console: any;
const g: any = globalThis; const out: string[] = []; const say = (...a: unknown[]) => { out.push(a.map(String).join(" ")) };
class Mine extends Error { constructor(public code: number) { super("mine " + code) } }
function values(k: number): unknown {
  try {
    switch (k) {
      case 0: throw 1; case 1: throw 1.5; case 2: throw "text"; case 3: throw undefined; case 4: throw null; case 5: throw true; case 6: throw { a: k }; case 7: throw [k, k + 1];
      case 8: throw new Error("literal"); case 9: throw new TypeError("made " + k); case 10: throw new Mine(k); case 11: throw Symbol.for("s"); case 12: throw 10n; case 13: throw -0; case 14: throw NaN; case 15: throw () => k;
    }
    return "nothing thrown"
  } catch (e) { return e }
}
for (let k = 0; k < 17; k++) { const v: any = values(k); say("values", k, typeof v, v instanceof Error ? v.name + ":" + v.message : typeof v === "function" ? v() : typeof v === "symbol" ? v.toString() : typeof v === "object" && v ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : v) }
function locals(n: number): string { let a = 0, b = "x", c = 1.5; const seen: number[] = []; try { a = n; b += n; if (n > 1) { c *= n; seen.push(n); throw a + 1 } a = -1; b = "not thrown" } catch (e) { return [a, b, c, seen.length, e].join() } return [a, b, c, seen.length].join() }
say("locals", locals(0), locals(2), locals(5));
function mayThrow(n: number): number { if (n === 3) throw new RangeError("from a call " + n); return n }
g.keepMayThrow = mayThrow;
function both(n: number): string { let where = "start"; try { where = "before the call"; const v = g.keepMayThrow(n); where = "behind the call"; if (v === 4) throw new Mine(v); where = "end"; return where } catch (e) { return where + ": " + (e as Error).message } }
say("both", both(1), both(3), both(4));
function nested(n: number): string { const t: string[] = []; try { try { t.push("in"); if (n === 1) throw "inner"; t.push("mid"); if (n === 2) throw new Mine(2) } catch (e) { t.push("caught " + (e instanceof Mine ? e.code : e)); if (n === 2) throw "again" } finally { t.push("finally") } t.push("behind"); if (n === 3) throw 3 } catch (e) { t.push("outer " + e) } return t.join() }
say("nested", nested(0), nested(1), nested(2), nested(3));
function finallyOnly(n: number): string { const t: string[] = []; const f = () => { try { t.push("a"); if (n) throw n; t.push("b") } finally { t.push("f") } return "r" }; try { t.push(f()) } catch (e) { t.push("out " + e) } return t.join() }
say("finallyOnly", finallyOnly(0), finallyOnly(7));
function returnsInFinally(n: number): number { try { if (n) throw n; return 1 } catch (e) { return (e as number) * 2 } finally { if (n === 5) return 50 } }
say("returnsInFinally", returnsInFinally(0), returnsInFinally(3), returnsInFinally(5));
function loops(n: number): string { let caught = 0, sum = 0; for (let i = 0; i < n; i++) { try { if (i % 3 === 0) throw i; sum += i } catch (e) { caught += e as number; continue } sum += 100 } let w = 0; while (true) { try { if (++w > 4) break; throw w } catch (e) { sum += e as number } } return [caught, sum, w].join() }
say("loops", loops(0), loops(7), loops(10));
function small(n: number): number { if (n < 0) throw new Mine(n); return n * 2 }
function copiedIn(n: number): string { try { return "ok " + (small(n) + small(n + 1)) } catch (e) { return "caught " + (e as Mine).code } }
say("copiedIn", copiedIn(1), copiedIn(-1), copiedIn(-5));
function withoutBinding(n: number): number { try { if (n) throw n; return 0 } catch { return 9 } }
function pattern(n: number): string { try { throw { p: n, q: [n + 1] } } catch ({ p, q: [r] }: any) { return p + "," + r } }
say("forms", withoutBinding(0), withoutBinding(1), pattern(4));
function inForIn(o: Record<string, number>): string { const t: string[] = []; for (const k in o) { try { if (o[k] < 0) throw k; t.push(k) } catch (e) { t.push("!" + e) } } return t.join() }
function overString(s: string): string { let t = ""; for (const c of s) { try { if (c === "b") throw c + c; t += c } catch (e) { t += "<" + e + ">" } } return t }
say("iterations", inForIn({ a: 1, b: -1, c: 2, d: -2 }), overString("abc\u{1F600}b"));
function escapes(n: number): number { if (n) throw new Mine(n); return 0 }
g.keepEscapes = escapes;
function elsewhere(n: number): string { try { return "" + g.keepEscapes(n) } catch (e) { return "elsewhere " + (e as Mine).code } }
say("negative", elsewhere(0), elsewhere(6));
function stacks(): string { try { throw new Error("here") } catch (e) { return String((e as Error).stack).split("\n").map(l => /:(\d+):\d+\)?$/.exec(l)).filter(m => m).slice(0, 2).map(m => m![1]).join(" | ") } }
say("stacks", stacks());
function* gen(n: number): Generator<string, string, unknown> { try { yield "one"; if (n) throw n; yield "two" } catch (e) { yield "caught " + e } finally { yield "finally" } return "done" }
say("generators", [...gen(0)].join(), [...gen(8)].join());
async function rejects(n: number): Promise<string> { if (n === 1) throw new Mine(1); await null; if (n === 2) throw "late"; try { await null; if (n === 3) throw 3; return "fine" } catch (e) { return "inside " + e } }
let hot = 0; for (let i = 0; i < 3000; i++) { try { if (i & 1) throw i; hot += 1 } catch (e) { hot += (e as number) & 3 } } say("hot", hot);
Promise.all([0, 1, 2, 3].map(n => rejects(n).then(v => "resolved " + v, e => "rejected " + (e instanceof Mine ? e.message : e)))).then(r => { say("async", r.join()); console.log(out.join("\n")) });
export {}
