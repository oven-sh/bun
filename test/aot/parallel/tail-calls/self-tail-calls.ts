// A function that calls itself in tail position is a loop over its parameters.
const log: string[] = [];
function note<T>(x: T): T { if (log.length < 40) log.push(String(x)); return x; }
function show(name: string, f: () => unknown): void {
  let answer: string;
  try { answer = JSON.stringify(f(), (_, v) => Object.is(v, -0) ? "-0" : v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v); } catch (e) { answer = (e as Error).name; }
  console.log(name, answer, log.join(" "));
  log.length = 0;
}

// The arguments are evaluated in order, before a parameter changes.
function swap(n: number, a: number, b: number): number[] { return n === 0 ? [a, b] : swap(n - 1, b, a); }
function order(n: number, a: number, b: number): number[] { if (n <= 0) return [n, a, b]; return order(note(n) - 1, note(b), note(a) + 1); }
function changed(n: number, a: number): number[] { if (n === 0) return [n, a]; a += n; return changed(n - 1, a); }
function assigned(n: number, a: number, b: number): number[] { if (n === 0) return [a, b]; return assigned(n - 1, (b = n), b + a); }
function stepped(n: number, a: number): number { if (a > 10) return n; return stepped(n, a + n++); }
function indexed(i: number, list: number[], s: number): string { if (s > 20 || i > 5) return i + ":" + s; return indexed(i, list, s + list[i++]! + i); }
function keptAside(n: number, k: number): number[] { return n > 3 ? [n, k] : keptAside(n + 1, (n++, k + n)); }
function changedByCall(n: number, a: number): number[] { if (a > 5) return [n, a]; const step = a + 1; n = n * 2; return changedByCall(n, (n = 50, step)); }
function halves(x: number, w: number): number { if (w < 1) return x; const t = w / 2; return halves(x % t, t); }
// @ts-expect-error
function refersToItself(n: number): number { if (n === 0) return 1; const x: number = n > 2 ? n : x + 1; return refersToItself(x - 1); }
function missing(n: number, a?: number): unknown[] { if (n === 0) return [a]; return n % 2 ? missing(n - 1) : missing(n - 1, n); }
function extra(n: number): number { return n === 0 ? 7 : (extra as any)(n - 1, note("x")); }
function extraByName(n: number, ...more: never[]): number { return n === 0 ? more.length : extraByName(n - 1); }
const defaults = (n: number, step = 1, out: number[] = []): number[] => { if (n <= 0) return out; out.push(n); return defaults(n - step, step, out); };
function defaultAgain(n: number, d: number | undefined = note(5)): number { return n === 0 ? d! : defaultAgain(n - 1, n === 2 ? undefined : d); }
function shadow(n: number): number { if (n > 100) return n; { const shadow = (x: number): number => x * 1000; if (n === 3) return shadow(n); } return shadow(n + 1); }
function parameterOfTheName(parameterOfTheName: any, n: number): any { return n === 0 ? "end" : parameterOfTheName(parameterOfTheName, n - 1); }
let replaced = function (n: number): any { return n === 0 ? "first" : replaced(n - 1); };
const firstReplaced = replaced;
function inLoops(n: number, a: number): number { for (let i = 0; i < 5; i++) { if (i === 3 && n > 0) return inLoops(n - 1, a + i); if (i + n === 4) break; } let k = 0; while (k < n) { if (++k === 2) return inLoops(n - 2, a * 2); } return a + k; }
function inHandlers(n: number, a: string): string { try { if (n === 2) throw new Error("t"); if (n === 4) return inHandlers(n - 1, a + "t"); } catch { return inHandlers(n - 1, a + "c"); } finally { note(n); } return n <= 0 ? a : inHandlers(n - 1, a + "n"); }
function closures(n: number, list: (() => number)[]): number[] { if (n === 0) return list.map(f => f()); list.push(() => n); return closures(n - 1, list); }
function locals(n: number, out: (number | undefined)[]): (number | undefined)[] { let late: number | undefined; out.push(late); if (n === 0) return out; late = n; const held = late * 2; out.push(held); return locals(n - 1, out); }
function kinds(n: number, v: any): any { return n === 0 ? v : kinds(n - 1, n === 5 ? "s" + v : n === 3 ? v.length : n === 2 ? v / 2 : n === 1 ? -v : v); }
function logical(n: number, s: string): boolean { return n === 0 || (s.charCodeAt(n % s.length) !== 33 && logical(n - 1, s)); }
function both(n: number, a: number): number { return n <= 0 ? a : both(n - 2, both(n - 1, a + 1)); }
function until(list: readonly number[], x: number, lo: number, hi: number): number { if (lo > hi) return -1; const m = (lo + hi) >> 1; if (list[m] === x) return m; return list[m]! < x ? until(list, x, m + 1, hi) : until(list, x, lo, m - 1); }
function huge(n: number, a: number): number { return n === 0 ? a : huge(n - 1, (a * 31 + n) % 1000003); }
function overflow(n: number): number { return n > 2147483650 ? n : overflow(n + (n > 2147483000 ? 1 : 2147483000)); }
function fraction(n: number, out: number[]): number[] { if (n > 3) return out; out.push(n); return fraction(n + 0.75, out); }
function isEven(n: number): boolean { return n === 0 ? true : isOdd(n - 1); }
function isOdd(n: number): boolean { return n === 0 ? false : isEven(n - 1); }
class Counter { total = 0; static down(n: number, a: number): number { return n === 0 ? a : Counter.down(n - 1, a + n); } add(n: number): number { if (n === 0) return this.total; this.total += n; return this.add(n - 1); } }
const named = function inner(n: number, a: string): string { return n === 0 ? a : inner(n - 1, a + n); };
function* generator(n: number): Generator<number, number> { if (n === 0) return 9; yield n; return yield* generator(n - 1); }
async function asynchronous(n: number, a: number): Promise<number> { return n === 0 ? a : asynchronous(n - 1, a + n); }

function deepThrow(n: number): number { if (n === 0) throw new Error("deep"); return deepThrow(n - 1); }

async function main(): Promise<void> {
  show("swap", () => [swap(5, 1, 2), swap(6, 0.5, -0)]);
  show("order", () => order(3, 1, 2));
  show("changed", () => changed(4, 0.5));
  show("assigned", () => assigned(4, 1, 2));
  show("stepped", () => [stepped(1, 0), stepped(1.5, 0), indexed(0, [1, 2, 3, 4, 5, 6, 7], 0), keptAside(0, 0), changedByCall(1, 0)]);
  show("quotients", () => [halves(7, 9), halves(100.5, 64)]);
  show("dead zone", () => refersToItself(4));
  show("missing", () => [missing(4, 1), missing(5, 1), missing(0)]);
  show("extra", () => [extra(3), extraByName(4)]);
  show("defaults", () => [defaults(3), defaults(5, 2), defaults(2, 1, [9])]);
  show("default again", () => [defaultAgain(3), defaultAgain(3, 8), defaultAgain(1, undefined)]);
  show("shadow", () => [shadow(1), shadow(4)]);
  show("parameter", () => parameterOfTheName((f: any, n: number) => "other" + n, 2));
  replaced = (n: number): any => "second" + n;
  show("replaced", () => firstReplaced(3));
  show("loops", () => [0, 1, 2, 3, 4, 5, 6, 7].map(n => inLoops(n, 1)));
  show("handlers", () => inHandlers(6, ""));
  show("closures", () => closures(4, []));
  show("locals", () => locals(3, []));
  show("kinds", () => [kinds(6, 12), kinds(4, [1, 2, 3]), kinds(2, 3), kinds(1, 0)]);
  show("logical", () => [logical(9, "abc"), logical(9, "ab!"), logical(200000, "xyz")]);
  show("both", () => [both(4, 0), both(9, 0.5)]);
  show("until", () => { const list = [1, 4, 7, 9, 12]; return [until(list, 7, 0, 4), until(list, 8, 0, 4), until([1.5, 2.5], 2.5, 0, 1), until([], 1, 0, -1), until(list, 12, 0, 9)]; });
  show("huge", () => huge(1000000, 1));
  show("overflow", () => overflow(1));
  show("fraction", () => fraction(0, []));
  show("mutual", () => [isEven(10), isOdd(7), isEven(3)]);
  show("methods", () => [Counter.down(5, 0), new Counter().add(5)]);
  show("named", () => named(4, "x"));
  show("generator", () => [...generator(3)]);
  try { deepThrow(5000); } catch (e) { console.log((e as Error).message, (e as Error).stack!.split("\n").filter(line => line.includes("deepThrow")).length); }
  console.log("asynchronous", await asynchronous(5, 0));
}
await main();
