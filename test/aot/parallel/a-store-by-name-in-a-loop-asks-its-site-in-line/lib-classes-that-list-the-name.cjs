// Six classes hold the name in slots of other kinds. What comes through `through` comes out of code that nobody compiled.
"use strict";
class Chest { constructor(n) { this.hinge = n; this.lid = 0; } }
class Trunk { constructor(n) { this.strap = n; this.lid = 0; this.lock = "x"; } }
class Coffer { constructor(n) { this.lid = 0.5; this.coin = n; } }
class Hamper { constructor(n) { this.wicker = n; this.cloth = n; this.lid = "shut"; } }
class Casket { constructor(n) { this.lid = null; this.velvet = n; } }
class Locker { constructor(n) { this.door = n; if (n > 100) this.lid = 1; } }
const through = new Function("given", "return given");
module.exports = { every: n => [new Chest(n), new Trunk(n), new Coffer(n), new Hamper(n), new Casket(n), new Locker(n)].map(one => through(one)), Coffer, Locker, through };
