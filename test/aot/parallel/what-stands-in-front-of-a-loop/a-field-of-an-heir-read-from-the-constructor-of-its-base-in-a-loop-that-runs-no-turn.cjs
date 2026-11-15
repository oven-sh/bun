// What stands in front of a loop: a field of an heir read from the constructor of its base in a loop that runs no turn.
"use strict";
const n = { turns: Number("0") };
class Base { constructor(log) { log.push(this.size()); } size() { return -1; } }
class Heir extends Base { constructor(log) { super(log); this.box = { w: Number("5") }; } size() { let s = 0; for (let i = 0; i < n.turns; i++) s += this.box.w; return s; } }
const log = []; const heir = new Heir(log); n.turns = Number("3"); log.push(heir.size());
console.log("SAID heir no-turn " + log.join());
