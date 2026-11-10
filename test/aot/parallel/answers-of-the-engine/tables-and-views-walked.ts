// A for-of, a pattern and a spread over a Map, a Set or a typed array step its table or read it by index where nobody can see the difference: entries added, deleted and cleared in the loop, classes below, an @@iterator of their own, memory that is detached or resized.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function entriesOf(map: Map<string, number>): string { let s = ""; for (const [key, value] of map) s += key + "=" + value + ";"; return s; }
report(entriesOf(new Map([["a", 1], ["b", 2]])));
report(entriesOf(new Map()));
function pairsOf(map: Map<any, any>): string { let s = ""; for (const pair of map) { s += pair.length + ":" + pair[0] + pair[1] + Array.isArray(pair) + ";"; pair[0] = "changed"; } return s + [...map.keys()].join(); }
report(pairsOf(new Map([[1, "x"], [2, "y"]])));
function membersOf(set: Set<number>): string { let s = ""; for (const member of set) s += member + ","; return s; }
report(membersOf(new Set([3, 1, 2, 3])));
report(membersOf(new Set()));
function anyOf(items: any): string { let s = ""; for (const item of items) s += String(item) + ";"; return s; }
report(anyOf(new Map([["k", "v"]])));
report(anyOf(new Set(["m"])));
report(anyOf(new Uint8Array([1, 2, 3])));
function growsMap(map: Map<number, number>): string { let s = ""; for (const [key, value] of map) { s += key + ":" + value + ","; if (key < 4) map.set(key + 2, value * 10); } return s + map.size; }
report(growsMap(new Map([[1, 1], [2, 2]])));
function growsFar(set: Set<number>): number { let n = 0; for (const member of set) { n++; if (member < 300) set.add(member + 1); } return n; }
report(growsFar(new Set([0])));
function deletesAhead(set: Set<number>): string { let s = ""; for (const member of set) { s += member + ","; set.delete(member + 1); } return s; }
report(deletesAhead(new Set([1, 2, 3, 4, 5])));
function deletesItself(map: Map<number, string>): string { let s = ""; for (const [key, value] of map) { s += key + value; map.delete(key); } return s + map.size; }
report(deletesItself(new Map([[1, "a"], [2, "b"], [3, "c"]])));
function deletesAndAddsAgain(set: Set<number>): string { let s = ""; let turns = 0; for (const member of set) { s += member + ","; if (turns++ < 3) { set.delete(member); set.add(member); } } return s; }
report(deletesAndAddsAgain(new Set([1, 2])));
function clears(map: Map<number, number>): string { let s = ""; for (const [key] of map) { s += key + ","; if (key === 2) { map.clear(); map.set(9, 9); } } return s; }
report(clears(new Map([[1, 1], [2, 2], [3, 3]])));
function clearsSet(set: Set<number>): string { let s = ""; for (const member of set) { s += member + ","; if (member === 1) set.clear(); } return s + set.size; }
report(clearsSet(new Set([1, 2, 3])));
class Sorted extends Set<number> { *[Symbol.iterator](): any { yield* [...super.values()].sort((a, b) => a - b); } }
report(membersOf(new Sorted([3, 1, 2])));
class Plain extends Map<string, number> {}
report(entriesOf(new Plain([["p", 1]])));
const ownMap: any = new Map([["a", 1]]);
ownMap[Symbol.iterator] = function* () { yield ["own", 7]; };
report(entriesOf(ownMap));
const ownSet: any = new Set([1]);
ownSet[Symbol.iterator] = function* () { yield 70; yield 71; };
report(membersOf(ownSet));
const moved: any = new Set([1, 2]);
Object.setPrototypeOf(moved, { [Symbol.iterator]: function* () { yield "moved"; } });
report(membersOf(moved));
let closed = "";
function closable(values: any[]): any { let i = 0; return { [Symbol.iterator]() { return this; }, next() { return i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined }; }, return() { closed += "r"; return {}; } }; }
report(membersOf(closable([1, 2]) as any));
function leaves(set: Set<number>): string { let s = ""; for (const member of set) { if (member === 2) break; s += member; } return s; }
report(leaves(new Set([1, 2, 3])));
report(leaves(closable([1, 2, 3]) as any));
report(closed);
function throwsIn(map: Map<number, number>): string { try { for (const [key] of map) { if (key === 2) throw new Error("two"); } return "none"; } catch (error: any) { return error.message; } }
report(throwsIn(new Map([[1, 1], [2, 2]])));
report(throwsIn(closable([[1, 1], [2, 2]]) as any));
report(closed);
function firstOf(set: Set<string>): string { const [first, second, third] = set; return first + "," + second + "," + third; }
report(firstOf(new Set(["a", "b"])));
report(firstOf(new Set()));
function restOf(set: Set<number>): string { const [first, ...rest] = set; return first + "/" + rest.join(); }
report(restOf(new Set([1, 2, 3])));
function addsBetweenSteps(set: Set<number>): string { let a, b, c; [a, b = (set.add(9), 5), c] = set; return a + "," + b + "," + c; }
report(addsBetweenSteps(new Set([1])));
function doneStaysDone(set: Set<number>): string { let a, b, c; [a, b = (set.add(9), 5), c] = set; return a + "," + b + "," + c + "/" + set.size; }
report(doneStaysDone(new Set()));
function firstEntry(map: Map<string, number>): string { const [[key, value]] = map; return key + value; }
report(firstEntry(new Map([["z", 26]])));
function spreads(set: Set<number>): string { return [...set].join() + "|" + [0, ...set, 9].join() + "|" + Math.max(...set); }
report(spreads(new Set([4, 2, 6])));
report(spreads(new Sorted([4, 2, 6])));
report(spreads(ownSet));
function spreadsMap(map: Map<string, number>): string { return JSON.stringify([...map]); }
report(spreadsMap(new Map([["a", 1]])));
report(spreadsMap(ownMap));
function nested(map: Map<string, Set<number>>): string { let s = ""; for (const [key, set] of map) for (const member of set) s += key + member + ","; return s; }
report(nested(new Map([["a", new Set([1, 2])], ["b", new Set([3])]])));
function objectsAsKeys(map: Map<object, number>): number { let sum = 0; for (const [key, value] of map) sum += value + Object.keys(key).length; return sum; }
report(objectsAsKeys(new Map<object, number>([[{ a: 1 }, 1], [{}, 2]])));
function mixedKeys(set: Set<any>): string { let s = ""; for (const member of set) s += typeof member + Object.is(member, -0) + ","; return s; }
report(mixedKeys(new Set([1, "1", 1.5, NaN, -0, null, undefined, true, 10n, Symbol.iterator, {}])));
function* yields(set: Set<number>): any { for (const member of set) yield member * 2; }
report([...yields(new Set([1, 2]))].join());
async function awaits(map: Map<string, number>): Promise<string> { let s = ""; for (const [key, value] of map) { s += key + (await value); map.delete("b"); } return s; }
report(await awaits(new Map([["a", 1], ["b", 2], ["c", 3]])));
function sumOfView(view: Uint32Array): number { let sum = 0; for (const value of view) sum += value; return sum; }
report(sumOfView(new Uint32Array([1, 2, 4000000000])));
report(sumOfView(new Uint32Array(0)));
function joinView(view: Float64Array): string { let s = ""; for (const value of view) s += value + ","; return s; }
report(joinView(new Float64Array([1.5, -0, NaN, Infinity])));
function bigView(view: BigInt64Array): string { let s = ""; for (const value of view) s += typeof value + value + ","; return s; }
report(bigView(new BigInt64Array([1n, -2n])));
function clamped(view: Uint8ClampedArray): string { let s = ""; for (const value of view) { s += value + ","; view[1] = 300; } return s; }
report(clamped(new Uint8ClampedArray([1, 2, 3])));
function patternOfView(view: Int16Array): string { const [a, b, c] = view; return a + "," + b + "," + c; }
report(patternOfView(new Int16Array([7, -8])));
function detaches(view: Uint8Array): string { let s = ""; try { for (const value of view) { s += value + ","; (view.buffer as any).transfer(); } } catch (error) { s += (error instanceof TypeError); } return s; }
report(detaches(new Uint8Array([1, 2, 3])));
function detachedAtOpen(view: Uint8Array): string { (view.buffer as any).transfer(); try { for (const value of view) return "turn" + value; return "none"; } catch (error) { return String(error instanceof TypeError); } }
report(detachedAtOpen(new Uint8Array([1])));
function shrinks(): string { const buffer = new (ArrayBuffer as any)(4, { maxByteLength: 8 }); const view = new Uint8Array(buffer); view.set([1, 2, 3, 4]); let s = ""; for (const value of view) { s += value + ","; if (value === 2) buffer.resize(3); } return s; }
report(shrinks());
function growsView(): string { const buffer = new (ArrayBuffer as any)(2, { maxByteLength: 8 }); const view = new Uint8Array(buffer); let s = ""; for (const value of view) { s += value + ","; if (s.length < 8) buffer.resize(buffer.byteLength + 1); } return s; }
report(growsView());
function outOfBounds(): string { const buffer = new (ArrayBuffer as any)(4, { maxByteLength: 8 }); const view = new Uint8Array(buffer, 2, 2); let s = ""; try { for (const value of view) { s += value + ","; buffer.resize(1); } } catch (error) { s += (error instanceof TypeError); } return s; }
report(outOfBounds());
class Doubled extends Uint8Array { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i++) yield this[i] * 2; } }
report(anyOf(new Doubled([1, 2])));
function sumOfBytes(view: Uint8Array): number { let sum = 0; for (const value of view) sum += value; return sum; }
report(sumOfBytes(new Doubled([1, 2])));
const ownView: any = new Uint8Array([1, 2]);
ownView[Symbol.iterator] = function* () { yield 50; };
report(sumOfBytes(ownView));
report(sumOfBytes([1, 2] as any));
report("end");
