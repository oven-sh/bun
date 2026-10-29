// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/language
// STATISTIC: SourceFilesInferred = 3

// FILE: parallel/language/array-iterator-prototypes-keep-members.js
// A compiled program locks the members that Array.prototype, Iterator.prototype and the prototypes of the built-in iterators have at the start. The objects stay extensible for ordinary names and for symbols that the program made. They take no index-like key, no well-known symbol, no then, no toJSON, no next, no return, no throw and no name of an object further up, and their prototypes stay. So a hole in an array is undefined, and a loop over an array steps and ends as the language says.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../../fixtures/changes-to-builtins.js";

const iteratorMembers = ["next", Symbol.toStringTag];
const namesAboveAnIterator = ["map", "filter", "toArray", "hasOwnProperty", "toString"];
const asyncGenerator = (async function* () {})();
const holders = [
  ["Array.prototype", Array.prototype, ["push", "pop", "map", "forEach", "join", "slice", "concat", "includes", "at", "constructor", "toString", "toLocaleString", Symbol.iterator, Symbol.unscopables], ["hasOwnProperty", "valueOf", "isPrototypeOf", "next", "return", "throw"], ["last"]],
  ["Iterator.prototype", Iterator.prototype, ["map", "filter", "take", "drop", "flatMap", "reduce", "toArray", "forEach", "some", "every", "find", Symbol.iterator, Symbol.dispose], ["hasOwnProperty", "valueOf", "toString", "next", "return", "throw"], []],
  ["array iterators", Object.getPrototypeOf([][Symbol.iterator]()), iteratorMembers, [...namesAboveAnIterator, "return", "throw"], []],
  ["map iterators", Object.getPrototypeOf(new Map()[Symbol.iterator]()), iteratorMembers, [...namesAboveAnIterator, "return", "throw"], []],
  ["set iterators", Object.getPrototypeOf(new Set()[Symbol.iterator]()), iteratorMembers, [...namesAboveAnIterator, "return", "throw"], []],
  ["string iterators", Object.getPrototypeOf(""[Symbol.iterator]()), iteratorMembers, [...namesAboveAnIterator, "return", "throw"], []],
  ["iterators of matchAll", Object.getPrototypeOf("".matchAll(/a/g)), iteratorMembers, [...namesAboveAnIterator, "return", "throw"], []],
  ["iterator helpers", Object.getPrototypeOf([].values().map(value => value)), ["next", "return", Symbol.toStringTag], [...namesAboveAnIterator, "throw"], []],
  ["async iterators", Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(asyncGenerator))), [Symbol.asyncIterator, Symbol.asyncDispose], ["hasOwnProperty", "valueOf", "toString", "next", "return", "throw"], []],
];
for (const [name, prototype, members, closedNames, openNames] of holders) {
  tryToChange(name + ": a member", prototype, members);
  tryToChange(name + ": a key it is closed for", prototype, [...indexLikeKeys, ...wellKnownSymbols.filter(symbol => !Object.hasOwn(prototype, symbol)), "then", "toJSON", ...closedNames]);
  tryToChange(name + ": any other key", prototype, ["addedByTheProgram", ...openNames, Symbol("mine"), Symbol.for("shared")]);
  tryToChangePrototype(name, prototype);
}

function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
console.log("Array.prototype is an empty array and stays one: " + [attempt(() => { Array.prototype.length = 1; return "done"; }), attempt(() => Array.prototype.push(1)), attempt(() => Array.prototype.pop()), attempt(() => Array.prototype.unshift(1)), Reflect.set(Array.prototype, "length", 1), Array.prototype.length, 0 in Array.prototype, Array.isArray(Array.prototype)].join(" "));

const mine = Symbol("mine");
Array.prototype.last = function () { return this[this.length - 1]; };
Object.defineProperty(Array.prototype, "second", { get() { return this[1]; }, configurable: true });
Array.prototype[mine] = function () { return this.length; };
Iterator.prototype.count = function () { let count = 0; for (const value of this) count++; return count; };
function useAdditions(list) { return [list.last(), list.second, list[mine](), list.values().count()].join("/"); }
console.log("what the program added: " + [[1, 2, 3].last(), [1, 2, 3].second, [1, 2, 3][mine](), new Set([1, 2]).values().count(), "abc"[Symbol.iterator]().count(), useAdditions(["a", "b"]), useAdditions(new Array(2).fill(7))].join(" "));
delete Array.prototype.last;
delete Array.prototype.second;
delete Array.prototype[mine];
delete Iterator.prototype.count;
console.log("and removed: " + [typeof [].last, typeof [].second, typeof [][mine], typeof [].values().count].join(" "));

function elementOf(list, key) { return list[key]; }
const holes = [1, , 3];
console.log("holes and what is past the end: " + [holes[1], elementOf(holes, 1), elementOf(holes, 5), elementOf(holes, -1), elementOf(holes, "1"), elementOf(holes, "1.5"), 1 in holes, holes.indexOf(undefined), holes.includes(undefined), new Array(3)[0], [, 1][0]].map(String).join(" "));

function firstOver(values, limit) { for (const value of values) if (value > limit) return value; return "none"; }
const [first, , third] = [1, 2, 3, 4];
console.log("loops that end early: " + [firstOver([1, 5, 9], 3), firstOver(new Set([1, 5, 9]), 6), firstOver(new Map([[1, 5]]).values(), 3), firstOver([1, 5, 9].values().map(value => value * 2), 3), firstOver([], 0), first, third].join(" "));

function* delegate(inner) { try { yield* inner; } catch (e) { yield "caught " + e; } }
const delegating = delegate([1, 2]);
console.log("yield* over an array finds no throw: " + [delegating.next().value, delegating.throw("thrown").value?.slice(0, 16), delegating.next().done].join(" "));

class Stack extends Array { push(...values) { return "its own push " + super.push(...values); } }
const own = [1, 2];
own.push = function () { return "its own push"; };
own[Symbol.iterator] = function* () { yield "its own iterator"; };
console.log("a subclass and an array with members of their own: " + [new Stack().push(1, 2), own.push(3), own.length, [...own].join(), Array.from(own).join()].join(" "));
console.log("what looks for a name on an array: " + [JSON.stringify([1, [2]]), (await Promise.resolve([1, 2])).length, [].concat([1], [[2]]).length, String([1, [2, 3]]), `${[1, 2]}`, Object.prototype.toString.call([]), [3, 1, 2].toSorted().join()].join(" "));

// FILE: fixtures/changes-to-builtins-sloppy.cjs
exports.assign = function (object, key, value) { object[key] = value; return "done"; };
exports.remove = function (object, key) { return delete object[key]; };

// FILE: fixtures/changes-to-builtins.js
// For the programs about locked built-ins. Tries every way to change a property or the prototype of an object, and prints what each way answered and whether the object changed. What changed is put back at once.
import { assign, remove } from "./changes-to-builtins-sloppy.cjs";

function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
function replacement() { return "replaced"; }

function answersForProperty(object, key) {
  const was = Object.getOwnPropertyDescriptor(object, key);
  const isUnchanged = () => {
    const now = Object.getOwnPropertyDescriptor(object, key);
    return was ? !!now && now.value === was.value && now.get === was.get && now.set === was.set : !now;
  };
  const answers = [];
  const note = (way, run) => {
    const answer = attempt(run);
    answers.push(way + " " + answer + "/" + (isUnchanged() ? "unchanged" : "changed"));
    if (isUnchanged()) return;
    if (was) Object.defineProperty(object, key, was);
    else delete object[key];
  };
  note("store", () => { object[key] = replacement; return "done"; });
  note("sloppy store", () => assign(object, key, replacement));
  note("Reflect.set", () => Reflect.set(object, key, replacement));
  note("define", () => { Object.defineProperty(object, key, { value: replacement, writable: true, configurable: true }); return "done"; });
  note("Reflect.defineProperty", () => Reflect.defineProperty(object, key, { get: replacement, configurable: true }));
  note("delete", () => delete object[key]);
  note("sloppy delete", () => remove(object, key));
  note("Reflect.deleteProperty", () => Reflect.deleteProperty(object, key));
  return answers.join(", ");
}

// One line for the keys that answer alike.
export function tryToChange(name, object, keys) {
  const groups = [];
  for (const key of keys) {
    const answers = answersForProperty(object, key);
    let group = groups.find(group => group.answers === answers);
    if (!group) groups.push(group = { answers, keys: [] });
    group.keys.push(String(key));
  }
  for (const group of groups) console.log(name + ": " + group.keys.join(" ") + ": " + group.answers);
}

export function tryToChangePrototype(name, object) {
  const was = Object.getPrototypeOf(object);
  const answers = [];
  const note = (way, run) => {
    const answer = attempt(run);
    const isUnchanged = Object.getPrototypeOf(object) === was;
    answers.push(way + " " + answer + "/" + (isUnchanged ? "unchanged" : "changed"));
    if (!isUnchanged) Object.setPrototypeOf(object, was);
  };
  note("Object.setPrototypeOf", () => { Object.setPrototypeOf(object, Object.create(was)); return "done"; });
  note("Reflect.setPrototypeOf", () => Reflect.setPrototypeOf(object, Object.create(was)));
  note("__proto__", () => { object.__proto__ = Object.create(was); return "done"; });
  note("the prototype it has", () => { Object.setPrototypeOf(object, was); return "done"; });
  console.log(name + ": its prototype: " + answers.join(", ") + ", extensible " + Object.isExtensible(object));
}

export const wellKnownSymbols = [
  Symbol.asyncDispose, Symbol.asyncIterator, Symbol.dispose, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator, Symbol.match, Symbol.matchAll,
  Symbol.replace, Symbol.search, Symbol.species, Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables,
];
export const indexLikeKeys = [0, 5, "7", "4294967294", "4294967295", "-1", "1.5", "-0", "NaN", "Infinity", "-Infinity", "1e+21"];
export const keysThatOnlyLookNumeric = ["01", "1.0", "+1", "1e3", "0x1"];

// FILE: fixtures/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// FILE: parallel/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: delegate get Stack push
// CHECK-LABEL: function {{*}}name="delegate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v4 = IteratorOpen v2 [isDelegating]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6) handler=b10():
// CHECK-NEXT: v7 = IteratorResume v4, v6 [readsValueWhenDone]
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b6(v9), notTaken b4(v9)
// CHECK-NEXT: b4(v10) handler=b10():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Yield v10, v2
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b5(v13), case b8(v13), otherwise b3(v13)
// CHECK-NEXT: b5(v15) handler=b10():
// CHECK-NEXT: v16 = IteratorResume v4, v15 resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b6(v18), notTaken b4(v18)
// CHECK-NEXT: b6(v19) handler=b10():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b8(v20) handler=b10():
// CHECK-NEXT: v21 = IteratorResume v4, v20 resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: Branch v22 -> taken b9(v23), notTaken b4(v23)
// CHECK-NEXT: b9(v24) handler=b10():
// CHECK-NEXT: Return v24
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v25 = CatchValue
// CHECK-NEXT: v26 = String string="caught "
// CHECK-NEXT: v27 = Add v26, v25
// CHECK-NEXT: v28 = Yield v27, v2
// CHECK-NEXT: v29 = ResultAt v28
// CHECK-NEXT: v30 = ResultAt v28 index=1
// CHECK-NEXT: Switch v30 cases=[1, 2] -> case b11(), case b12(), otherwise b13()
// CHECK-NEXT: b11():
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b12():
// CHECK-NEXT: Return v29
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=undefined|null|string|Array flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Stack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasRestParameter, HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="its own push "
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = GetSuperBase v3 homeKind=ClassPrototype
// CHECK-NEXT: v5 = SuperGet v4, v0 key="push"
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v1
// CHECK-NEXT: v8 = CallList v5, v0, v6 calleeName="super.push"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v2, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
