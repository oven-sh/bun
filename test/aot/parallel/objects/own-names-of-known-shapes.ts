// hasOwn and hasOwnProperty under a written name on arrays, parameters and variables whose objects are known to be of a few shapes, of which some have the name.
let out = "";
const say = (name: string, v: unknown): void => { out += name + "=" + String(v) + " "; };
// Literals that nothing changes.
const still: any[] = [{ a: 1, b: 2 }, { b: 3, c: 4, a: 5 }, { z: 1 }];
function stillOwn(n: number): number { let r = 0; for (let i = 0; i < n; i++) r = r * 2 + (Object.hasOwn(still[i % 3], "a") ? 1 : 0); return r; }
function stillMethod(n: number): number { let r = 0; for (let i = 0; i < n; i++) r = r * 2 + (still[i % 3].hasOwnProperty("c") ? 1 : 0); return r; }
function stillCall(n: number): number { let r = 0; for (let i = 0; i < n; i++) r = r * 2 + (Object.prototype.hasOwnProperty.call(still[i % 3], "z") ? 1 : 0); return r; }
function stillBoth(n: number): number { let r = 0; for (let i = 0; i < n; i++) { const o = still[i % 3]; if (Object.hasOwn(o, "a") && !Object.hasOwn(o, "c")) r += o.a; else if (o.hasOwnProperty("z")) r += 100; else r += 10; } return r; }
// Literals that lose, gain and redefine a name.
const lost: any[] = [{ p: 1, q: 2 }, { q: 3 }, { p: 4 }, { r: 5 }];
function lostOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += Object.hasOwn(lost[i & 3], "p") ? 1 : 0; return t; }
const gained: any[] = [{ s: 1 }, { t: 2 }, { s: 3, t: 4 }, { u: 5 }];
function gainedOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += (Object.hasOwn(gained[i & 3], "s") ? 1 : 0) + "" + (gained[i & 3].hasOwnProperty("t") ? 1 : 0); return t; }
const keyed: any[] = [{ k: 1 }, { l: 2 }, { k: 3, l: 4 }, { m: 5 }];
function keyedOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += Object.hasOwn(keyed[i & 3], "k") ? 1 : 0; return t; }
const described: any[] = [{ d: 1 }, { e: 2 }, { d: undefined, e: 4 }];
function describedOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += (Object.hasOwn(described[i % 3], "d") ? 1 : 0) + "" + (Object.prototype.hasOwnProperty.call(described[i % 3], "e") ? 1 : 0); return t; }
const frozen: any[] = [Object.freeze({ f: 1 }), Object.seal({ g: 2 }), { f: 3, g: 4 }];
function frozenOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += Object.hasOwn(frozen[i % 3], "f") ? 1 : 0; return t; }
const above: any[] = [{ h: 1 }, { i: 2 }, { i: 3 }];
function aboveOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += (Object.hasOwn(above[i % 3], "h") ? 1 : 0) + "" + ("h" in above[i % 3] ? 1 : 0); return t; }
const accessors: any[] = [{ get v() { return 1; } }, { w: 2 }, { v: 3 }];
function accessorsOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += accessors[i % 3].hasOwnProperty("v") ? 1 : 0; return t; }
// Instances of classes, and written unions.
class Leaf { kind = "leaf"; value = 1; }
class Branch { kind = "branch"; children: Node2[] = []; }
class Wide extends Branch { extra = 2; }
type Node2 = Leaf | Branch | Wide;
function hasChildren(n: Node2): boolean { return Object.hasOwn(n, "children"); }
function hasExtra(n: Node2): boolean { return n.hasOwnProperty("extra"); }
const nodes: Node2[] = [new Leaf(), new Branch(), new Wide(), new Leaf()];
function nodesOwn(n: number): string { let t = ""; for (let i = 0; i < n; i++) { const o = nodes[i & 3]!; t += (hasChildren(o) ? 1 : 0) + "" + (hasExtra(o) ? 1 : 0) + (Object.hasOwn(o, "kind") ? 1 : 0); } return t; }
type Shape = { type: "circle"; radius: number } | { type: "square"; side: number } | { type: "dot" };
function size(s: Shape): number { return Object.hasOwn(s, "radius") ? (s as any).radius * 3 : s.hasOwnProperty("side") ? (s as any).side : 0; }
const shapes: Shape[] = [{ type: "circle", radius: 2 }, { type: "square", side: 5 }, { type: "dot" }];
function shapesOwn(n: number): number { let r = 0; for (let i = 0; i < n; i++) r += size(shapes[i % 3]!); return r; }
// Made in the turn.
function made(n: number): string { let t = ""; for (let i = 0; i < n; i++) { const o: any = i % 3 === 0 ? { x: i } : i % 3 === 1 ? { y: i } : { x: i, y: 1 }; if (i % 7 === 5) delete o.x; if (i % 5 === 4) o.x = 1; t += Object.hasOwn(o, "x") ? 1 : 0; } return t; }
function optional(x?: number): any { return x === undefined ? { name: "n" } : { name: "n", x }; }
function optionals(n: number): string { let t = ""; for (let i = 0; i < n; i++) t += Object.hasOwn(optional(i & 1 ? i : undefined), "x") ? 1 : 0; return t; }
for (let turn = 0; turn < 4; turn++) {
  say("own", stillOwn(9)); say("method", stillMethod(9)); say("call", stillCall(9)); say("both", stillBoth(9)); say("lost", lostOwn(8)); say("gained", gainedOwn(8)); say("keyed", keyedOwn(8)); say("described", describedOwn(6)); say("frozen", frozenOwn(6)); say("above", aboveOwn(6)); say("accessors", accessorsOwn(6)); say("nodes", nodesOwn(8)); say("shapes", shapesOwn(6)); say("made", made(36)); say("optionals", optionals(6));
  console.log(out); out = "";
  if (turn === 0) { delete lost[0].p; gained[1].s = 1; keyed[1]["k" + ""] = 1; Object.defineProperty(described[1], "d", { value: 1, configurable: true }); Object.setPrototypeOf(above[1], above[0]); }
  if (turn === 1) { delete lost[2].p; lost[3].p = 9; gained[3].t = 2; delete gained[0].s; delete keyed[0]["k" + ""]; Object.defineProperty(described[0], "d", { enumerable: false }); Object.defineProperty(described[0], "e", { get() { return 1; } }); Object.setPrototypeOf(above[2], null as any); Object.defineProperty(accessors[1], "v", { get() { return 2; } }); (nodes[0] as any).children = []; (shapes[2] as any).side = 7; }
  if (turn === 2) { for (let i = 0; i < 70; i++) { gained[0]["n" + i] = i; keyed[2]["n" + i] = i; } delete described[1].d; (nodes[3] as any).extra = 1; delete (nodes[2] as any).children; above[1] = { h: 5 }; lost.push({ p: 1 }); lost.length = 4; }
}
const strangers: any[] = [undefined, null, 5, "a", true, Symbol("s"), [1], () => 1, new Map(), Object.create(null), new Proxy({ a: 1 }, {})];
for (let i = 0; i < strangers.length; i++) { let t = ""; try { t += Object.hasOwn(strangers[i], "a"); } catch (e) { t += (e as Error).name; } try { t += strangers[i].hasOwnProperty("a"); } catch (e) { t += (e as Error).name; } try { t += Object.prototype.hasOwnProperty.call(strangers[i], "a"); } catch (e) { t += (e as Error).name; } say(String(i), t); }
console.log(out);
