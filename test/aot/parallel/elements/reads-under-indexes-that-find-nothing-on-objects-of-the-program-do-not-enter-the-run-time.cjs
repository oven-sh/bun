// COUNTER: operationAOTGetByVal <= 40
"use strict";
const hide = v => [v][JSON.parse("0")];
class Row { constructor() { this.a = 1; } }
class Wide extends Row { constructor() { super(); this.b = 2; } m() { return 1; } }
class Bag extends Map {}
function Made() { this.x = 1; }
const receivers = [new Row(), new Wide(), { a: 1 }, {}, new Made(), new Bag(), Object.create(new Row()), Object.create({ a: 1 }), Object.create(new Bag()), Object.create(Object.create(new Wide()))].map(hide);
function count(o, turns) { let found = 0; for (let i = 0; i < turns; i++) found += o[i] === undefined ? 0 : 1; return found; }
let total = 0;
for (const o of receivers) total += count(o, 300);
console.log(total, receivers.length);
