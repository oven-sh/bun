"use strict";
class Box { constructor(held) { Object.defineProperty(this, "held", { enumerable: true, configurable: true, writable: true, value: held }); } }
const kinds = [1, 2.5, "text", null, undefined, true, { a: 1 }, [1], 10n, Symbol.iterator];
let told = ""; for (let turn = 0; turn < 3000; turn++) { const box = new Box(kinds[turn % kinds.length]); if (turn >= 2990) told += typeof box.held + (Object.hasOwn(box, "held") ? "+" : "-"); }
console.log(told);
