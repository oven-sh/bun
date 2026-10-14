"use strict";
class B { constructor(x) { this.x = x; } } class P extends B { constructor(x, y) { super(x); this.y = y; } }
function F(x) { this.x = x; } class Q extends F { constructor(x, y) { super(x); this.y = y; } }
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += new P(1, 2).y + new Q(1, 2).x; return s; }
module.exports = { run };
