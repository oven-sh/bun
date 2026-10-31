// Rarely taken checks before calls: each block prints something else, or crashes, if the compiler leaves one of them out.
declare const console: any;
import { Base, Derived, Heir, DerivedOfClass, constructWith, ownCallOf, ownApplyOf, UntypedWithItsOwn, UntypedWithout, UntypedHeir, putOn, defineOn, inheritFrom, untypedFunction, callNamed } from "./untyped-classes-and-their-constructor-arguments.js";
const said: string[] = [];
function block(name: string, body: () => unknown) { try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + (error as any)?.constructor?.name); } }
function attempt(body: () => unknown): string { try { return String(body()); } catch (error) { return "THROWS " + (error as any)?.constructor?.name; } }

// The closure is not callable: a class may declare `static call`, which does not show in its structure.
class WithItsOwn { static call(..._: unknown[]) { return "the class's own call"; } static apply(..._: unknown[]) { return "the class's own apply"; } }
class Without { x = 1; }
function callOf(f: any): unknown { return f.call(null, 1); }
function applyOf(f: any): unknown { return f.apply(null, [1]); }
block("a class with a static call, of a value nobody knows", () => [attempt(() => callOf(WithItsOwn)), attempt(() => applyOf(WithItsOwn)), attempt(() => callOf(Without)), attempt(() => applyOf(Without)), attempt(() => callOf(function (this: unknown, a: number) { return "called " + a; }))].join(" | "));
block("the same, named", () => [attempt(() => (WithItsOwn as any).call(null, 1)), attempt(() => (WithItsOwn as any).apply(null, [1])), attempt(() => (Without as any).call(null, 1))].join(" | "));
block("the same, from code without types", () => [attempt(() => ownCallOf(WithItsOwn)), attempt(() => ownApplyOf(WithItsOwn)), attempt(() => ownCallOf(Without))].join(" | "));

// A slim closure that has been given an own property.
function slim(this: unknown, a?: number) { return "slim called " + a; }
function slimToo(this: unknown, a?: number) { return "slimToo called " + a; }
block("a function before it has its own call", () => [slim.call(null, 1), slim.apply(null, [2]), slimToo.call(null, 3)].join(" | "));
(slim as any).call = function () { return "its own call"; };
(slim as any).apply = function () { return "its own apply"; };
block("a function with its own call, named", () => [slim.call(null, 1), slim.apply(null, [2]), slimToo.call(null, 3)].join(" | "));
block("a function with its own call, of a value nobody knows", () => [callOf(slim), applyOf(slim), callOf(slimToo)].join(" | "));

// The same where no analysis of the program can see the store: a key that is computed, a store from code without types, another prototype.
const keys: string[] = JSON.parse('["call", "apply"]');
function third(this: unknown, a?: number) { return "third called " + a; }
function fourth(this: unknown, a?: number) { return "fourth called " + a; }
function fifth(this: unknown, a?: number) { return "fifth called " + a; }
function sixth(this: unknown, a?: number) { return "sixth called " + a; }
block("functions as they were made", () => [third.call(null, 1), fourth.apply(null, [2]), fifth.call(null, 3), sixth.call(null, 4), callNamed()].join(" | "));
(third as any)[keys[0]] = function () { return "third's own, by a computed key"; };
putOn(fourth, keys[1], function () { return "fourth's own, put from code without types"; });
defineOn(fifth, "call", function () { return "fifth's own, defined"; });
inheritFrom(sixth, { call() { return "what sixth inherits"; }, apply() { return "what sixth inherits"; } });
putOn(untypedFunction, "call", function () { return "untypedFunction's own"; });
block("functions with their own, named", () => [third.call(null, 1), third.apply(null, [1]), fourth.apply(null, [2]), fourth.call(null, 2), fifth.call(null, 3), attempt(() => sixth.call(null, 4)), callNamed()].join(" | "));
block("functions with their own, of a value nobody knows", () => [callOf(third), applyOf(fourth), callOf(fifth), attempt(() => callOf(sixth)), callOf(untypedFunction)].join(" | "));
block("classes of code without types", () => [attempt(() => callOf(UntypedWithItsOwn)), attempt(() => applyOf(UntypedWithItsOwn)), attempt(() => callOf(UntypedHeir)), attempt(() => callOf(UntypedWithout)), attempt(() => ownCallOf(UntypedWithItsOwn)), attempt(() => ownCallOf(UntypedHeir)), attempt(() => ownApplyOf(UntypedWithout))].join(" | "));
class Later { y = 2; }
block("a class before it is given a call", () => attempt(() => callOf(Later)));
putOn(Later, keys[0], function () { return "Later's own"; });
block("a class that was given a call", () => [attempt(() => callOf(Later)), attempt(() => (Later as any).call(null, 1)), attempt(() => ownCallOf(Later))].join(" | "));

// Math.max.apply(null, list): the list is not a cell.
function most(list: number[] | undefined | null): number { return Math.max.apply(null, list as any); }
function least(list: number[] | undefined | null): number { return Math.min.apply(null, list as any); }
function mostOfAnything(list: any): number { return Math.max.apply(null, list); }
block("Math.max.apply of a list that is none", () => [most([1, 5, 3]), most(undefined), most(null), least([4, 2]), least(undefined), least(null), most([])].join());
block("Math.max.apply of anything", () => [mostOfAnything([1, 9]), mostOfAnything(undefined), mostOfAnything(null), mostOfAnything({ length: 2, 0: 7, 1: 8 }), attempt(() => mostOfAnything(5)), attempt(() => mostOfAnything("ab")), attempt(() => mostOfAnything(true))].join());

// new.target is not a closure of the program.
block("super(..) with new.target the class, an heir", () => [constructWith(Derived, Derived), constructWith(Derived, Heir), constructWith(Heir, Heir), constructWith(DerivedOfClass, DerivedOfClass)].join(" | "));
block("super(..) with new.target a function of the engine", () => [constructWith(Derived, Array), constructWith(Derived, Object), constructWith(Derived, Map), constructWith(DerivedOfClass, Array)].join(" | "));
block("super(..) with new.target a bound function, a proxy", () => [constructWith(Derived, Derived.bind(null)), constructWith(Derived, new Proxy(Derived, {})), constructWith(Derived, new Proxy(Base, {})), constructWith(DerivedOfClass, Base.bind(null))].join(" | "));
block("super(..) with new.target an ordinary function of the program", () => [constructWith(Derived, Base), constructWith(DerivedOfClass, Base), constructWith(Derived, function () { })].join(" | "));

// The small integer is within the type's range; a value that is not a number where an integer is expected.
type Small = 0 | 1 | 2;
function take(x: Small): string { return "took " + x; }
type Wide = 100000 | 200000 | -5;
function takeWide(x: Wide): string { return "took " + x; }
const outside: any[] = JSON.parse('[1, 7, -1, 3, 2, 2147483647, -2147483648, 200000, -5, 100001]');
block("a small integer from outside, within the range of the type or not", () => outside.map(v => attempt(() => take(v))).join(" | ") + " || " + outside.map(v => attempt(() => takeWide(v))).join(" | "));
const noIntegers: any[] = [1.5, -0, NaN, Infinity, 2.0, 1e300, "1", "", true, false, null, undefined, {}, [], [1], Symbol.iterator, 1n, () => 1, new Number(1)];
block("what is no integer where one is due", () => noIntegers.map(v => attempt(() => take(v))).join(" | "));
block("what is no integer where one that is kept as an integer is due", () => noIntegers.map(v => attempt(() => takeWide(v))).join(" | "));
console.log(said.join("\n"));
export {};
