// Each of these initializers changes something that other code reads. What it changes is looked at before its constant is first read: the change has been made where the constant is declared.
let counter = 0;
const aCounter = { v: ++counter };
let calls = 0;
function next(): number { return ++calls; }
const aCounterInAFunction = { v: next() };
const registry: string[] = [];
const aPushToAList = { v: registry.push("made") };
const names: string[] = [];
function register(name: string): { name: string } { names.push(name); return { name }; }
const aPushInAFunction = register("made");
const byName = new Map<string, number>();
const aMapEntry = { v: byName.set("made", 1).size };
const members = new Set<string>();
const aSetMember = { v: members.add("made").size };
const state = { made: false };
function mark(): { ok: boolean } { state.made = true; return { ok: true }; }
const aStoreToAConstant = mark();
const target: { a: number; z?: number } = { a: 1 };
const anAssignToAConstant = Object.assign(target, { z: 1 });
const cold = { a: 1 };
const aFreezeOfAConstant = Object.freeze(cold);
const inner = { a: 1 };
const aFreezeInsideALiteral = { inner: Object.freeze(inner) };
const sealed = { a: 1 };
function seal<V extends object>(it: V): Readonly<V> { return Object.freeze(it); }
const aFreezeInAHelper = { it: seal(sealed) };
const defined: { a?: number } = {};
const aDefinitionOnAConstant = Object.defineProperty(defined, "a", { value: 1, enumerable: true });
class Made { static count = 0; constructor() { Made.count++; } }
const aStaticField = new Made();
function tagged(): void {}
const aPropertyOfAFunction = Object.assign(tagged, { tag: 1 });
const seen: number[] = [];
const aStoreInACallback = [1, 2].map(x => seen.push(x));
const visited: number[] = [];
function visit(all: number[]): number[] { for (const x of all) visited.push(x); return all; }
const aStoreInALoop = visit([1, 2]);
const touched = { by: "" };
const aStoreInAGetter = { ...{ get a(): number { touched.by = "getter"; return 1; } } };
const cells = [{ n: 1 }];
const aStoreToAnElementOfAConstantList = cells.map(cell => { cell.n = 2; return cell.n; });
const aGlobal = { v: ((globalThis as unknown as { madeMarker?: number }).madeMarker = 1) };
const unsorted = [2, 1];
const aSortOfAConstantList = unsorted.sort();
const shrinking: { a?: number } = { a: 1 };
function drop(): { ok: boolean } { return { ok: delete shrinking.a }; }
const aDeletion = drop();
const heir = {};
const parent = { inherited: 1 };
const aPrototype = Object.setPrototypeOf(heir, parent) as object;
function readAll(): number { return [aCounter, aCounterInAFunction, aPushToAList, aPushInAFunction, aMapEntry, aSetMember, aStoreToAConstant, anAssignToAConstant, aFreezeOfAConstant, aFreezeInsideALiteral, aFreezeInAHelper, aDefinitionOnAConstant, aStaticField, aPropertyOfAFunction, aStoreInACallback, aStoreInALoop, aStoreInAGetter, aStoreToAnElementOfAConstantList, aGlobal, aSortOfAConstantList, aDeletion, aPrototype].length; }
console.log("aCounter", String(counter));
console.log("aCounterInAFunction", String(calls));
console.log("aPushToAList", registry.join());
console.log("aPushInAFunction", names.join());
console.log("aMapEntry", String(byName.size));
console.log("aSetMember", String(members.size));
console.log("aStoreToAConstant", String(state.made));
console.log("anAssignToAConstant", Object.keys(target).join());
console.log("aFreezeOfAConstant", String(Object.isFrozen(cold)));
console.log("aFreezeInsideALiteral", String(Object.isFrozen(inner)));
console.log("aFreezeInAHelper", String(Object.isFrozen(sealed)));
console.log("aDefinitionOnAConstant", Object.keys(defined).join());
console.log("aStaticField", String(Made.count));
console.log("aPropertyOfAFunction", Object.keys(tagged).join());
console.log("aStoreInACallback", seen.join());
console.log("aStoreInALoop", visited.join());
console.log("aStoreInAGetter", touched.by);
console.log("aStoreToAnElementOfAConstantList", String(cells[0]!.n));
console.log("aGlobal", String((globalThis as unknown as { madeMarker?: number }).madeMarker));
console.log("aSortOfAConstantList", unsorted.join());
console.log("aDeletion", Object.keys(shrinking).join() || "none");
console.log("aPrototype", String("inherited" in heir));
console.log(String(readAll()));
