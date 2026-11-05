// answers: without-library
// # `set.size`, `map.size`, `view.length`: a read that finds a getter of one of the engine's classes is the code of its row, on an object that is as its class makes it. An object that hides the name, stands below a class of the program or below something else goes by the lookup.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 44 of 44 of 44
// # CHECK-NEXT: exited with 0
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
function sizes(a: Set<number>, b: Map<string, number>) { return a.size * 100 + b.size; }
function lengths(a: Int32Array, b: Float64Array, c: Uint8Array) { return a.length * 10000 + b.length * 100 + c.byteLength; }
function sizeOfAnything(a: any) { return a.size; }
class Below extends Set<number> { get size() { return 7; } }
class BelowAsItIs extends Set<number> { extra = 1; }
const set = new Set<number>([1, 2]);
const map = new Map<string, number>();
const shadowed: any = new Set([1]);
Object.defineProperty(shadowed, "size", { value: 99 });
const relinked: any = new Set([1, 2, 3]);
Object.setPrototypeOf(relinked, { size: "elsewhere" });
const withoutPrototype: any = new Set([1, 2, 3, 4]);
Object.setPrototypeOf(withoutPrototype, null);
for (let round = 0; round < 3; round++) { report(sizes(set, map)); set.add(10 + round); map.set("k" + round, round); report(sizes(set, map)); set.delete(1); report(set.size); report(sizes(shadowed, map)); report(sizes(new Below(), map)); report(sizes(new BelowAsItIs([1, 2, 3]), map)); report(String(sizeOfAnything(relinked))); report(String(sizeOfAnything(withoutPrototype))); report(sizeOfAnything(set)); report(sizeOfAnything(map)); report(String(sizeOfAnything({ size: "own" }))); report(lengths(new Int32Array(3 + round), new Float64Array(2), new Uint8Array(5))); attempt(() => sizeOfAnything(null)); attempt(() => Object.create(Set.prototype).size); }
map.clear();
set.clear();
report(sizes(set, map));
report("end");
