// The look at the structure says nothing of own properties under symbols: a member under a symbol is read by name.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class H extends Map { first() { return this[Symbol.iterator]().next().value[0]; } }
const one = new H(); one.set(5, 6); let sum = 0;
function f() { let s = 0; for (let i = 0; i < 8; i++) s += one.first() + one[Symbol.iterator]().next().value[1]; return s; }
for (let t = 0; t < 400; t++) { sum += f(); if (t === 200) Object.defineProperty(one, Symbol.iterator, { value() { return [[1000, 2000]][Symbol.iterator](); }, configurable: true }); if (t === 300) delete one[Symbol.iterator]; }
console.log(sum);
