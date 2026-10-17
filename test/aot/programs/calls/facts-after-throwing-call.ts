// Inside `try`, what the compiler knows after a call that may throw holds only on the path where nothing was thrown.
declare const console: any;
class Box { constructor(public v: number, public w: string = "w") {} }
class Trapped { private _v = 0; sets = 0; get v(): number { if (this._v > 2) throw new RangeError("get " + this._v); return this._v; } set v(n: number) { this.sets++; if (n < 0) throw new RangeError("set " + n); this._v = n; } }
const log: string[] = [];
function thrower(when: boolean, what: string): void { if (when) throw new Error(what); }
// The handler sees the store before the throw; the store after it does not happen.
function storesAroundAThrow(fail: boolean): string { const b = new Box(1); try { b.v = 2; thrower(fail, "t"); b.v = 3; return "end " + b.v; } catch (e) { return "caught " + b.v; } }
// The store itself throws: the field keeps its old value, in the handler and after it.
function storeThatThrows(n: number): string { const t = new Trapped(); let r = ""; try { t.v = 1; t.v = n; r = "stored " + t.v; } catch (e: any) { r = "caught " + e.message; } return r + " " + t.sets; }
// The read itself throws.
function readThatThrows(n: number): string { const t = new Trapped(); t.v = n; try { const a = t.v; const b = t.v; return "read " + a + b; } catch (e: any) { return "caught " + e.message; } }
// A frozen object: the store throws in strict code, and the read after the handler sees the old value.
function frozen(freeze: boolean): string { const b = new Box(1); if (freeze) Object.freeze(b); try { b.v = 2; return "stored " + b.v; } catch (e: any) { return "caught " + e.constructor.name + " " + b.v; } }
// null or undefined receivers.
function nilReceiver(b: Box | undefined): string { try { const a = b!.v; const c = b!.v; return "read " + (a + c); } catch (e: any) { return "caught " + e.constructor.name; } }
function nilStore(b: Box | undefined): string { try { (b as Box).v = 5; return "stored " + (b as Box).v; } catch (e: any) { return "caught " + e.constructor.name; } }
// Somebody else stores in between, through an alias, through a call, in a loop.
function alias(a: Box, b: Box): string { try { a.v = 1; b.v = 2; return "" + a.v + b.v; } catch (e) { return "caught"; } }
function call(a: Box, f: (b: Box) => void): string { try { a.v = 1; f(a); return "" + a.v; } catch (e) { return "caught " + a.v; } }
function loop(a: Box, n: number): string { let s = ""; try { for (let i = 0; i < n; i++) { s += a.v; a.v = a.v + 1; thrower(i === 3, "l"); } return s + ":" + a.v; } catch (e) { return s + " caught " + a.v; } }
// Nested handlers, finally, rethrow.
function nested(fail: number): string { const b = new Box(0); try { b.v = 1; try { b.v = 2; thrower(fail === 1, "in"); b.v = 3; } catch (e) { log.push("inner " + b.v); b.v = 4; thrower(fail === 1, "again"); } finally { log.push("finally " + b.v); b.v = b.v + 10; } thrower(fail === 2, "out"); return "end " + b.v; } catch (e: any) { return "caught " + e.message + " " + b.v; } }
// The value that was stored is of another type than the read asks for.
function widened(x: number | string): string { const o: { f: number | string } = { f: 0 }; try { o.f = x; const r = o.f; return typeof r + ":" + r; } catch (e) { return "caught"; } }
// Two objects of one shape made here, and one that escapes between the store and the read.
const kept: Box[] = [];
function escapes(): string { const a = new Box(1), b = new Box(2); try { a.v = 3; kept.push(a); kept[kept.length - 1].v = 9; b.v = 4; return "" + a.v + b.v; } catch (e) { return "caught"; } }
// A variable of the module and of an environment under a handler.
let moduleVariable = 0;
function variables(fail: boolean): string { let local = 0; const bump = () => { local++; moduleVariable++; }; try { moduleVariable = 1; local = 1; bump(); thrower(fail, "v"); return "end " + moduleVariable + local; } catch (e) { return "caught " + moduleVariable + local; } }
for (let round = 0; round < 3; round++) {
  console.log(storesAroundAThrow(false), storesAroundAThrow(true), storeThatThrows(2), storeThatThrows(-1), storeThatThrows(5), readThatThrows(1), readThatThrows(3), frozen(false), frozen(true));
  console.log(nilReceiver(new Box(2)), nilReceiver(undefined), nilStore(new Box(2)), nilStore(undefined));
  const one = new Box(0), two = new Box(0);
  console.log(alias(one, two), alias(one, one), call(one, b => { b.v = 7; }), call(one, b => { b.v = 8; throw 1; }), call(one, () => {}), loop(new Box(0), 3), loop(new Box(0), 9));
  log.length = 0; console.log(nested(0), nested(1), nested(2), log.join());
  console.log(widened(1), widened("s"), widened(1.5), escapes(), variables(false), variables(true));
}
export {};
