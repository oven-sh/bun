"use strict";
class Base { constructor(a) { Object.defineProperty(this, "a", { enumerable: true, configurable: true, writable: true, value: a }); Object.defineProperty(this, "b", { enumerable: true, configurable: true, writable: true, value: a + 1 }); Object.defineProperty(this, "c", { enumerable: true, configurable: true, writable: true, value: a + 2 }); } }
class Heir extends Base { constructor(a) { super(a); Object.defineProperty(this, "d", { enumerable: true, configurable: true, writable: true, value: a + 3 }); Object.defineProperty(this, "e", { enumerable: true, configurable: true, writable: true, value: "e" + a }); Object.defineProperty(this, "f", { enumerable: true, configurable: true, writable: true, value: void 0 }); } }
const kept = []; let said = 0;
for (let turn = 0; turn < 20000; turn++) { const heir = new Heir(turn & 31); if (turn % 1000 === 0) kept.push(heir); said = (said + heir.a + heir.b + heir.c + heir.d + heir.e.length) % 1000003; }
console.log(said, kept.length, JSON.stringify(kept[3]), Object.keys(kept[5]).join(), "f" in kept[1]);
