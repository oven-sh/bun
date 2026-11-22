// at() of arrays of every kind, arrays with names and an own at, heirs, arguments, views and texts, with positions of every kind; by name outside loops, in loops, and by a value that was read.
let digest = 0, cases = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const show = (v: any): string => typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? String(v) + typeof v + (v === 0 ? 1 / v : "") : "{" + Object.keys(v) + "}";
class List extends Array<any> { }
class Own extends Array<any> { override at(k: number): any { return "own" + k; } }
const makers: Record<string, () => any> = {
  ints: () => [5, 6, 7], doubles: () => [0.5, -0, NaN, 1e300], mixed: () => [1, "a", null, undefined, { x: 1 }], holes: () => [1, , 3], doubleHoles: () => { const a: any[] = [0.5, 1.5]; a.length = 4; return a; }, empty: () => [], undecided: () => new Array(3), far: () => { const a: any[] = [1]; a[5000] = 2; return a; }, huge: () => { const a: any[] = [1, 2]; a.length = 4294967295; return a; }, hugeEnd: () => { const a: any[] = [0.5]; a[4294967294] = 7; return a; }, aboveInt32: () => { const a: any[] = [1]; a[2147483647] = 8; a.length = 2147483649; return a; }, heldLength: () => { const a: any[] = [1, 2, 3, 4, 5, 6]; a.length = 2; return a; }, shifted: () => { const a = [1, 2, 3, 4]; a.shift(); return a; }, frozen: () => Object.freeze([1, 2]), sealed: () => Object.seal([1.5]), named: () => Object.assign([1, 2], { kind: "k" }),
  ownAt: () => { const a: any = [1, 2]; a.at = (k: any) => "shadow" + k; return a; }, list: () => { const l = new List(); l.push(1, 2); return l; }, own: () => { const l = new Own(); l.push(1, 2); return l; }, constant: () => [10, 20, 30], split: () => "a,b,c".split(","), match: () => /(\d)/.exec("a1"), rest: () => ((...r: any[]) => r)(1, "z"), reparented: () => Object.setPrototypeOf([1, 2], { at: (k: any) => "above" + k }), nulled: () => Object.setPrototypeOf([1, 2], null),
  bytes: () => new Uint8Array([1, 2, 3]), floats: () => new Float64Array([0.5, -0]), big: () => new BigInt64Array(2), text: () => "héllo", boxed: () => new String("ab"), likeArray: () => ({ length: 2, 0: "x", 1: "y", at: Array.prototype.at }), args: () => (function (..._: any[]) { return arguments; })(1, 2), nothing: () => null, number: () => 5,
};
const positions: any[] = [0, 1, 2, 5, -1, -2, -3, -4, -100, 2147483647, -2147483648, 4294967295, 1.5, -1.5, -0, NaN, Infinity, -Infinity, "1", "-1", "x", "", null, undefined, true, { valueOf: () => 1 }, [], [1]];
function byName(a: any, k: any): any { return a.at(k); }
function without(a: any): any { return a.at(); }
function many(a: any, k: any): any { return a.at(k, 2, 3); }
function borrowed(a: any, k: any): any { return Array.prototype.at.call(a, k); }
function inLoop(a: any, k: any): string { let t = ""; for (let i = -2; i < 3; i++) t += show(a.at(i)) + show(a.at(k)); return t; }
function read(a: any, k: any): any { const f = a.at; return f.call(a, k); }
const attempt = (f: () => any): string => { try { return show(f()); } catch (e) { return (e as Error).name; } };
for (let round = 0; round < 3; round++) for (const [m, make] of Object.entries(makers)) {
  let line = m;
  for (const k of positions) line += ";" + attempt(() => byName(make(), k)) + attempt(() => many(make(), k)) + attempt(() => borrowed(make(), k)) + attempt(() => inLoop(make(), k)) + attempt(() => read(make(), k));
  line += attempt(() => without(make()));
  let order = ""; attempt(() => byName({ get length() { order += "l"; return 2; }, at: Array.prototype.at, get 1() { order += "g"; return "one"; } }, { valueOf() { order += "v"; return 1; } })); line += order;
  add(line); if (round === 2) console.log(m, line.length, digest);
}
let sum = 0;
for (let i = 0; i < 3000; i++) { const a: any = [i, i + 0.5, "x"]; sum = (sum + a.at(-2) + a.at(0) + a.at(-1).length + (a.at(3) === undefined ? 1 : 0)) % 1000003; }
console.log(cases, digest, sum);
