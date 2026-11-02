export interface T { a?: number; b: number }
interface Keyed { b: number; constructor: unknown }
class MyMap extends Map<string, number> {}
class OtherMap extends Map<string, number> {}
class MySet extends Set<number> {}
class MyDate extends Date {}
class MyError extends Error {}
class MyRegExp extends RegExp {}
class MyBytes extends Uint8Array {}
class MyBuffer extends ArrayBuffer {}
class P { constructor(public x: number, public y?: number) {} }
class Q extends P { z = 1; }
class Same { a = 1; }
const Same2 = (() => { class Same { a = 1; } return Same; })();
const anonymous = () => class { a = 1; };
const Anonymous = anonymous(), Anonymous2 = anonymous();
const mixin = <B extends new (...args: any[]) => object>(Base: B) => class extends Base {};
const MixedMap = mixin(Map), MixedP = mixin(P);
class ClockDate extends Date { constructor(time: number) { super(time); Object.defineProperty(this, "constructor", { value: Date, enumerable: false }); } }
class Base { a = 1; }
class Derived extends Base {}
delete hide(Derived.prototype).constructor;
class Named { a = 1; get ["constructor"]() { return Named; } }
const unread = () => class Unread { m() { return 1; } };
const Unread1 = unread(), Unread2 = unread(), Unread3 = unread(), Unread4 = unread();
function hide(value: unknown): any { return value; }
const plain = (...entries: [string, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of entries) o[k] = v; return o; };
const withPrototype = <V extends object>(value: V, prototype: object | null): V => Object.setPrototypeOf(value, prototype);
const withExtra = <V extends object>(value: V, key: string, extra: unknown): V => { hide(value)[key] = extra; return value; };
const withHidden = <V extends object>(value: V, key: string, extra: unknown): V => Object.defineProperty(value, key, { value: extra, enumerable: false });
const computed = (key: string, value: unknown): T => ({ b: 1, [key]: value }) as T;
export const cases: [string, () => unknown, () => unknown][] = [
  ["built-in: a Map and an heir", () => new MyMap([["a", 1]]), () => new Map([["a", 1]])],
  ["built-in: two of one heir", () => new MyMap([["a", 1]]), () => new MyMap([["a", 1]])],
  ["built-in: two heirs of Map", () => new MyMap([["a", 1]]), () => new OtherMap([["a", 1]])],
  ["built-in: a Set and an heir", () => new MySet([1]), () => new Set([1])],
  ["built-in: a Date and an heir", () => new MyDate(5), () => new Date(5)],
  ["built-in: an Error and an heir", () => new MyError("x"), () => new Error("x")],
  ["built-in: two of one heir of Error", () => new MyError("x"), () => new MyError("x")],
  ["built-in: a RegExp and an heir", () => new MyRegExp("a"), () => new RegExp("a")],
  ["built-in: a Uint8Array and an heir", () => new MyBytes([1]), () => new Uint8Array([1])],
  ["built-in: an ArrayBuffer and an heir", () => new MyBuffer(2), () => new ArrayBuffer(2)],
  ["built-in: a Buffer and a Uint8Array", () => Buffer.from([1]), () => new Uint8Array([1])],
  ["built-in: a Map and a mixin over it", () => new MixedMap(), () => new Map()],
  ["built-in: two mixins over Map", () => new MixedMap(), () => new (mixin(Map))()],
  ["built-in: a Date that owns the constructor Date", () => new ClockDate(5), () => new Date(5)],
  ["built-in: inside a typed object", () => ({ b: 1, v: new MyMap() }) as T, () => ({ b: 1, v: new Map() }) as T],
  ["instances: the same", () => new P(1, 2), () => new P(1, 2)],
  ["instances: a class and its heir", () => new Q(1), () => new P(1)],
  ["instances: a class and a mixin over it", () => new MixedP(1), () => new P(1)],
  ["instances: against a record", () => new P(1, 2), () => ({ x: 1, y: 2 }) as { x: number; y: number }],
  ["instances: against a plain object", () => new P(1, 2), () => plain(["x", 1], ["y", 2])],
  ["instances: two classes with one name", () => new Same(), () => new Same2()],
  ["instances: one class with that name", () => new Same(), () => new Same()],
  ["instances: two classes with no name", () => new Anonymous(), () => new Anonymous2()],
  ["instances: one class with no name", () => new Anonymous(), () => new Anonymous()],
  ["instances: no name, against a record", () => new Anonymous(), () => ({ a: 1 }) as { a: number }],
  ["instances: no name, against a plain object", () => new Anonymous(), () => plain(["a", 1])],
  ["instances: an heir without a constructor of its own", () => new Derived(), () => new Base()],
  ["instances: born by Object.create", () => Object.assign(Object.create(P.prototype), { x: 1, y: undefined }), () => new P(1)],
  ["instances: a getter named constructor", () => new Named(), () => new Named()],
  ["instances: a getter named constructor, against a record", () => new Named(), () => ({ a: 1 }) as { a: number }],
  ["instances: in an array", () => [new P(1)], () => [new Q(1)]],
  ["instances: Map values", () => new Map([[1, new P(1)]]), () => new Map([[1, new Q(1)]])],
  ["instances: Set members", () => new Set([new P(1)]), () => new Set([new Q(1)])],
  ["prototypes: of a class and of its heir", () => P.prototype, () => Q.prototype],
  ["prototypes: of two classes", () => P.prototype, () => Same.prototype],
  ["prototypes: of two classes with one name", () => Same.prototype, () => Same2.prototype],
  ["prototypes: of one class", () => P.prototype, () => P.prototype],
  ["prototypes: of two classes with one name, which nothing has read", () => Unread1.prototype, () => Unread2.prototype],
  ["prototypes: an object made from one that nothing has read, and another such prototype", () => Object.create(Unread3.prototype), () => Unread4.prototype],
  ["typed | typed: the same", () => ({ b: 1 }) as T, () => ({ b: 1 }) as T],
  ["typed | plain: the same", () => ({ b: 1 }) as T, () => plain(["b", 1])],
  ["typed | typed: a null prototype", () => withPrototype({ b: 1 } as T, null), () => ({ b: 1 }) as T],
  ["typed | typed: both with a null prototype", () => withPrototype({ b: 1 } as T, null), () => withPrototype({ b: 1 } as T, null)],
  ["typed | plain: a null prototype on the plain one", () => ({ b: 1 }) as T, () => withPrototype(plain(["b", 1]), null)],
  ["typed | typed: the prototype of a class", () => withPrototype({ x: 1, y: undefined } as { x: number; y?: number }, P.prototype), () => new P(1)],
  ["a field named constructor: the same object in it", () => ({ b: 1, constructor: { b: 1 } }) as Keyed, () => ({ b: 1, constructor: { b: 1 } }) as Keyed],
  ["a field named constructor: other values", () => ({ b: 1, constructor: 1 }) as Keyed, () => ({ b: 1, constructor: 2 }) as Keyed],
  ["a field named constructor: NaN", () => ({ b: 1, constructor: NaN }) as Keyed, () => ({ b: 1, constructor: NaN }) as Keyed],
  ["a field named constructor: undefined against absent", () => ({ b: 1, constructor: undefined }) as Keyed, () => ({ b: 1 }) as T],
  ["a field named constructor: against a plain object", () => ({ b: 1, constructor: { b: 1 } }) as Keyed, () => plain(["b", 1], ["constructor", plain(["b", 1])])],
  ["a field named constructor: one class in both", () => ({ b: 1, constructor: Map }) as Keyed, () => ({ b: 1, constructor: Map }) as Keyed],
  ["a field named constructor: two classes", () => ({ b: 1, constructor: Map }) as Keyed, () => ({ b: 1, constructor: Set }) as Keyed],
  ["a field named constructor: a class against a value", () => ({ b: 1, constructor: Map }) as Keyed, () => ({ b: 1, constructor: 1 }) as Keyed],
  ["a field named constructor: Object against absent", () => ({ b: 1, constructor: Object }) as Keyed, () => ({ b: 1 }) as T],
  ["an extra named constructor: the same object in it", () => withExtra({ b: 1 } as T, "constructor", { b: 1 }), () => withExtra({ b: 1 } as T, "constructor", { b: 1 })],
  ["an extra named constructor: other values", () => withExtra({ b: 1 } as T, "constructor", 1), () => withExtra({ b: 1 } as T, "constructor", 2)],
  ["an extra named constructor: NaN", () => withExtra({ b: 1 } as T, "constructor", NaN), () => withExtra({ b: 1 } as T, "constructor", NaN)],
  ["an extra named constructor: on one side", () => withExtra({ b: 1 } as T, "constructor", 1), () => ({ b: 1 }) as T],
  ["an extra named constructor: against the field", () => withExtra({ b: 1 } as T, "constructor", { b: 1 }), () => ({ b: 1, constructor: { b: 1 } }) as Keyed],
  ["an extra named constructor: against a plain object", () => withExtra({ b: 1 } as T, "constructor", 1), () => plain(["b", 1], ["constructor", 1])],
  ["an extra named constructor: one class in both", () => withExtra({ b: 1 } as T, "constructor", Map), () => withExtra({ b: 1 } as T, "constructor", Map)],
  ["an extra named constructor: two classes", () => withExtra({ b: 1 } as T, "constructor", Map), () => withExtra({ b: 1 } as T, "constructor", Set)],
  ["an extra named constructor: the class of the other side", () => withExtra({ x: 1, y: 2 } as { x: number; y: number }, "constructor", P), () => new P(1, 2)],
  ["an extra named constructor: on an instance", () => withExtra(new P(1), "constructor", Q), () => new P(1)],
  ["an extra named constructor: on an instance, its own class", () => withExtra(new P(1), "constructor", P), () => new P(1)],
  ["a hidden constructor: the same object in it", () => withHidden({ b: 1 } as T, "constructor", { b: 1 }), () => withHidden({ b: 1 } as T, "constructor", { b: 1 })],
  ["a hidden constructor: other values", () => withHidden({ b: 1 } as T, "constructor", 1), () => withHidden({ b: 1 } as T, "constructor", 2)],
  ["a hidden constructor: on one side", () => withHidden({ b: 1 } as T, "constructor", 1), () => ({ b: 1 }) as T],
  ["a hidden constructor: two classes", () => withHidden({ b: 1 } as T, "constructor", Map), () => withHidden({ b: 1 } as T, "constructor", Set)],
  ["a hidden constructor: the class of the other side", () => withHidden({ x: 1, y: 2 } as { x: number; y: number }, "constructor", P), () => new P(1, 2)],
  ["a computed key that spells constructor: the same object in it", () => computed(hide("constructor"), { b: 1 }), () => computed(hide("constructor"), { b: 1 })],
  ["a computed key that spells constructor: two classes", () => computed(hide("constructor"), Map), () => computed(hide("constructor"), Set)],
  ["a computed key that spells constructor: against the field", () => computed(hide("constructor"), 1), () => ({ b: 1, constructor: 1 }) as Keyed],
  ["a getter named constructor in a record", () => ({ b: 1, get constructor() { return Map; } }) as Keyed, () => ({ b: 1, get constructor() { return Set; } }) as Keyed],
  ["a key named constructor deep inside", () => ({ b: 1, v: [{ b: 1, constructor: [1] } as Keyed] }) as T, () => ({ b: 1, v: [{ b: 1, constructor: [1] } as Keyed] }) as T],
];
