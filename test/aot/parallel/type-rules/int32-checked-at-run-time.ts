// An `int32` is a promise that the build proves, and nothing tests it when the program runs. A value that reaches an `int32` by a way the build does not follow (a call through a function value, a store through an untyped reference, a wider type) goes on as it is, as in plain Bun. type-rules/int32-unproven-stores has the flows that stop the build, and type-rules/int32-members-of-objects-that-came-in-with-a-number the objects that are made with a number, as by a spread.
import type { int32 } from "bun";

class Cursor { line: int32 = 0; }
interface Spot { kind: "spot"; at: int32 }
interface Mark { kind: "mark"; at: number }
const given: number[] = JSON.parse("[3, 1.5, 2147483648]");
function hide(value: unknown): any { return value; }
function half(n: int32): int32 { return n >> 1; }
function lineOf(cursor: Cursor): int32 { return cursor.line; }
function atOf(spot: Spot): int32 { return spot.at; }
function place(target: Spot | Mark, at: number): void { target.at = at; }
function attempt(name: string, f: () => unknown): void {
  try { console.log(name, String(f())); } catch (e) { const message = (e as Error).message, note = message.indexOf(" (bun compile checks types"); console.log(name, (e as Error).name + (note < 0 ? "" : ": " + message.slice(0, note))); }
}

attempt("an untyped call with an int32:", () => hide(half)(given[0]));
attempt("an untyped call with a fraction:", () => hide(half)(given[1]));
attempt("an untyped call with a number out of range:", () => hide(half)(given[2]));
attempt("an untyped call with nothing:", () => hide(half)());
attempt("a callback of map, int32 only:", () => given.slice(0, 1).map(half).join());
attempt("a callback of map:", () => given.map(half).join());
attempt("a bound argument:", () => half.bind(null, given[1])());
attempt("a store through an untyped reference:", () => { const cursor = new Cursor(); hide(cursor).line = given[1]; return hide(cursor).line; });
attempt("a typed read after it:", () => { const cursor = new Cursor(); hide(cursor).line = given[1]; return lineOf(cursor); });
attempt("a typed read after an untyped store of an int32:", () => { const cursor = new Cursor(); hide(cursor).line = given[0]; return lineOf(cursor); });
attempt("a typed read after a store through a wider type:", () => { const spot: Spot = { kind: "spot", at: 1 }; place(spot, given[1]); return atOf(spot); });
attempt("a read through the wider type:", () => { const mark: Mark = { kind: "mark", at: 1 }; place(mark, given[1]); return mark.at; });
