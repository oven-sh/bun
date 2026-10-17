// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
for (let round = 0; round < 2; round++) {
  for (const line of m.known()) console.log(line);
  console.log(m.order().join(), "|", m.prototypes().join(), "|", m.closures().join(), "|", m.ordinary().map(String).join());
  for (const line of m.mixed([m.Point, m.Empty, m.Base, m.Fields, m.ReturnsObject, m.arrow, m.makeCounter(1), m.Rest, Object, Array, (Array as any).bind(null, 0), Map, class Local { v = 1; }, function () { return [1]; }, null, undefined, 5, {}, new Proxy(m.Point, {}), m.Point.bind(null, 7)])) console.log(line);
}
console.log(m.log.join());
// From outside: Reflect.construct with another new.target, a subclass in typed code, `new` from typed code.
console.log(Object.getPrototypeOf(Reflect.construct(m.Point, [1, 2], m.Empty)) === m.Empty.prototype, (Reflect.construct(m.Point, [1, 2], Array) as any) instanceof Array, JSON.stringify(Reflect.construct(m.Fields, [], m.Point)));
class Derived extends (m.Base as any) { y = 2; }
class DerivedFromFunction extends (m.Point as any) { constructor() { super(5, 6); } }
console.log(JSON.stringify(new (Derived as any)(1)), new (Derived as any)(3).double, JSON.stringify(new DerivedFromFunction()), new DerivedFromFunction().sum(), new DerivedFromFunction() instanceof m.Point);
export {};
