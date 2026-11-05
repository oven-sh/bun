// answers: with-library
// # codegen/AOTStraightEmitter.h: one sweep over the body as read, every value boxed in a word of the frame, each operation in its most general form. With testing=WritesBodiesStraight every body that has such a form takes it.
// # The operators, reads and writes by name and by key, literals, patterns, loops, switches, closures, handlers, tail calls and classes, on numbers, texts, nothing and objects.
// # OPTIONS: testing=WritesBodiesStraight
// # RUN(STRAIGHT): compile UnitsWrittenStraight mechanisms=all
// # REQUIRES(STRAIGHT): entries-of-bun
// # STRAIGHT-NOT: statistic UnitsWrittenStraight 0
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 57 of 57 of 57
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function sums(a: any, b: any) { return [a + b, a - b, a * b, a / b, a % b, a ** 2, -a, +b, a | b, a & b, a ^ b, a << 1, a >> 1, a >>> 1, ~a].join(" "); }
function compares(a: any, b: any) { return [a < b, a <= b, a > b, a >= b, a == b, a != b, a === b, a !== b, !a, !!b, typeof a, typeof b].join(" "); }
function chooses(a: any, b: any) { return [a && b, a || b, a ?? b, a ? 1 : 2, a?.x, a?.[0]].join(" "); }
function reads(o: any, k: any) { return [o.x, o[k], "x" in o, k in o, delete o.gone, o.gone, Object.keys(o).length].join(" "); }
function writes(o: any, k: any, v: any) { o.x = v; o[k] = v + 1; o.n ??= 5; o.m ||= 6; o.x += 2; o[k]++; return o.x + ":" + o[k] + ":" + o.n + ":" + o.m; }
function makes(a: any, b: any) { const o = { a, b, [a + "k"]: b, get sum() { return this.a + this.b; }, set both(v: any) { this.a = v; this.b = v; }, twice() { return this.sum * 2; } }; const before = o.twice(); o.both = 4; return before + ":" + o.sum + ":" + o[a + "k"]; }
function lists(a: any, b: any) { const l = [a, , b, ...[a, b]]; const [x, , y = 9, ...rest] = l; return l.length + ":" + x + ":" + y + ":" + rest.length + ":" + (1 in l); }
function takes({ p, q = 3, ...others }: any, ...more: any[]) { return p + ":" + q + ":" + Object.keys(others).length + ":" + more.length; }
function counts(n: any) { let s = 0; for (let i = 0; i < n; i++) { if (i === 2) continue; if (i === 6) break; s += i; } let j = 0; while (j < n) j += 2; do { j--; } while (j > n); return s + ":" + j; }
function names(o: any) { let s = ""; for (const k in o) s += k + "=" + o[k] + ";"; return s; }
function picks(v: any) { switch (v) { case 1: return "one"; case "two": return "two"; case 3: case 4: v += 10; default: return "other " + v; } }
function words(v: any) { switch (v) { case "alpha": return 1; case "beta": return 2; case "gamma": return 3; case "delta": return 4; case "epsilon": return 5; default: return 0; } }
function closes(n: any) { let held = n; const up = () => ++held; const both = () => [up(), up(), held].join(","); return both; }
function tries(v: any) { let trail = ""; try { trail += "a"; if (v === 1) throw new TypeError("one"); if (v === 2) return trail + "r"; trail += "b"; } catch (e) { trail += "c" + (e as Error).message; } finally { trail += "f"; report(trail); } return trail; }
function nests(v: any) { let kept = "k" + v; try { try { kept += "1"; if (v) null[v]; kept += "2"; } finally { kept += "3"; } } catch (e) { return kept + (e as Error).name; } return kept; }
function tails(n: any, sum: any): any { "use strict"; return n === 0 ? sum : tails(n - 1, sum + n); }
class Base { x: any; static made = 0; constructor(x: any) { this.x = x; Base.made++; } get twice() { return this.x * 2; } say() { return "base " + this.x; } static of(x: any) { return new this(x); } }
class Derived extends Base { #hidden = 7; y = 5; constructor(x: any) { super(x + 1); } say() { return "derived " + super.say() + " " + this.#hidden + " " + this.y; } has(o: any) { return #hidden in o; } }
function builds(x: any) { const d = Derived.of(x) as Derived; return [d.say(), d.twice, d instanceof Base, d.has(d), d.has({}), Base.made].join(" "); }
function texts(a: any, b: any) { return `${a}-${b}-${a + b}` + a.length + a[0] + (a < b); }
function early() { const before = tell(() => late); let late = 1; return before + late; }
function asks(f: any) { return tell(() => f()) + tell(() => new f()) + tell(() => f.x.y); }
for (const [a, b] of [[7, 2], [1.5, -3], ["4", 2], [null, undefined], [true, "x"], [{ x: 1 }, [2]]] as any[]) { report(tell(() => sums(a, b))); report(tell(() => compares(a, b))); report(tell(() => chooses(a, b))); }
report(reads({ x: 1, y: 2, gone: 3 }, "y"));
report(writes({}, "k", 1));
report(writes({ n: 0, m: 0 }, 0, "s"));
report(makes(1, 2));
report(makes("s", "t"));
report(lists(1, undefined));
report(takes({ p: 1, r: 2, s: 3 }, 4, 5));
report(counts(9));
report(names({ a: 1, b: "two", 3: 3 }));
for (const v of [1, "two", 3, 4, 5, undefined] as any[]) report(picks(v));
for (const v of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", 1] as any[]) report(words(v));
report(closes(5)());
for (const v of [0, 1, 2]) report(tries(v));
report(nests(0));
report(nests(1));
report(tails(20000, 0));
report(builds(1));
report(builds("s"));
report(texts("ab", "cd"));
report(early());
report(asks(undefined));
report(asks(() => 1));
report("end");
