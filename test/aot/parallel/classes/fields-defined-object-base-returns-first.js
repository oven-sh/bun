// The base class returns an object that exists already, so the fields of the class below it are defined on that object. It has the first of them as a property that is read-only and not configurable.
class Base { constructor(o) { return o; } }
class D extends Base { a = 1; b = 2; c = 3; d = 4; }
for (let i = 0; i < 40; i++) new D({});
const o = Object.defineProperty({}, "a", { value: 0, writable: false, enumerable: false, configurable: false });
try { new D(o); console.log("ok"); } catch (e) { console.log(e.constructor.name); }
console.log(JSON.stringify(Object.getOwnPropertyDescriptors(o)));
