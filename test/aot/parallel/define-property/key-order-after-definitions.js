// The order of own keys: indexes ascending, then strings in the order of creation, then symbols, whatever way each came.
"use strict";
const s1 = Symbol("s1"), s2 = Symbol("s2");
class Point { constructor() { this.x = 1; this.y = 2; } }
function Made() { this.p = 1; }
const keys = o => Reflect.ownKeys(o).map(String).join() + " | " + Object.keys(o).join() + " | " + JSON.stringify(o);
for (let turn = 0; turn < 4; turn++) {
  for (const make of [() => ({ a: 1, b: 2, c: 3 }), () => new Point(), () => new Made(), () => ({})]) {
    let o = make();
    Object.defineProperty(o, s1, { value: 1, enumerable: true });
    Object.defineProperty(o, "z", { value: 1, enumerable: true });
    Object.defineProperty(o, "10", { value: 1, enumerable: true });
    o.k = 1;
    Object.defineProperty(o, "2", { value: 1, enumerable: true, configurable: true });
    Object.defineProperty(o, "f", { get() { return 1; }, enumerable: true, configurable: true });
    Object.defineProperty(o, s2, { get() { return 1; } });
    o.e = 1;
    console.log(keys(o));
    delete o.f; delete o[2]; delete o.a; delete o.x; delete o.p;
    console.log(keys(o));
    Object.defineProperty(o, "a", { value: 9, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(o, "x", { value: 9, enumerable: true });
    Object.defineProperty(o, "p", { get() { return 9; }, enumerable: true });
    Object.defineProperty(o, "f", { value: 9, enumerable: true });
    Object.defineProperty(o, "z", { value: 1 });
    Object.defineProperty(o, "k", { enumerable: false });
    console.log(keys(o));
    o = make();
    Object.defineProperties(o, { c: { value: 7, enumerable: true }, n2: { value: 1, enumerable: true }, b: { enumerable: false }, 1: { value: 1, enumerable: true }, n1: { value: 1, enumerable: true }, [s2]: { value: 1 }, y: { value: 5, enumerable: true }, 0: { value: 0, enumerable: true } });
    console.log(keys(o));
    console.log(keys(Object.defineProperties(make(), Object.getOwnPropertyDescriptors(o))));
    console.log(keys(Object.defineProperties({}, Object.getOwnPropertyDescriptors(o))));
    console.log(keys(Object.assign(make(), o)), keys({ ...o }));
  }
}
