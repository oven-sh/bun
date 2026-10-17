// Objects that the engine makes hold little themselves: an error's message is hidden, a map's size is a getter, an array's length is hidden, a function's name is hidden.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface HasMessage { message: string }
interface Sized { size: number }
interface HasLength { length: number }
interface Named { name: string }
const message = (e: HasMessage): HasMessage => ({ ...e });
const sized = (s: Sized): Sized => ({ ...s });
const long = (l: HasLength): HasLength => ({ ...l });
const named = (n: Named): Named => ({ ...n });
row("an error", () => typeof message(new Error("x")).message);
row("a map", () => sized(new Map([[1, 2]])).size + 1);
row("a set", () => typeof sized(new Set([1])).size);
row("an array", () => long([1, 2, 3]).length + 1);
row("a function", () => typeof named(function f() {}).name);
row("plain objects", () => message({ message: "m" }).message + sized({ size: 1 }).size + long({ length: 2 }).length + named({ name: "n" }).name);
