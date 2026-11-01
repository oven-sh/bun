// More names than the storage of an object holds at first, and more than a Structure chain is long: definitions in every form, read back.
"use strict";
class Point { constructor() { this.x = 1; } }
function check(o, count) {
  let sum = 0, listed = 0, writable = 0, configurable = 0;
  for (let i = 0; i < count; i++) {
    const d = Object.getOwnPropertyDescriptor(o, "k" + i);
    sum += "value" in d ? d.value : d.get.call(o);
    listed += d.enumerable; writable += !!d.writable; configurable += d.configurable;
  }
  return [sum, listed, writable, configurable, Object.keys(o).length, Reflect.ownKeys(o).length].join();
}
for (let turn = 0; turn < 3; turn++) {
  for (const make of [() => ({ a: 1 }), () => new Point(), () => ({})]) {
    for (const count of [3, 7, 20, 70, 300]) {
      const o = make();
      for (let i = 0; i < count; i++) {
        const name = "k" + i;
        switch (i % 5) {
        case 0: Object.defineProperty(o, name, { value: i }); break;
        case 1: Object.defineProperty(o, name, { value: i, enumerable: true, writable: true, configurable: true }); break;
        case 2: Object.defineProperty(o, name, { get() { return i; }, enumerable: true }); break;
        case 3: Reflect.defineProperty(o, name, { value: i, writable: true }); break;
        default: Object.defineProperties(o, { [name]: { value: i, configurable: true } });
        }
      }
      console.log(turn, count, check(o, count));
    }
  }
}
