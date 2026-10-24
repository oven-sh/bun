"use strict";
function P(x) { this.x = x; } function Q(x) { this.x = x + 1; }
function WithStatics(x) { this.x = x; } WithStatics.create = function () {}; WithStatics.prototype = { marker: 1 };
function Optional(x, y, z) { this.x = x; }
class K { constructor(x) { this.x = x; } }
function fewer(a, b, c) { return a; } function fewer2(a, b, c) { return 1; }
function make(a, b, n) { let s = 0; for (let i = 0; i < n; i++) { const F = i & 1 ? a : b; s += new F(1).x; } return s; }
function call(a, b, n) { let s = 0; for (let i = 0; i < n; i++) { const f = i & 1 ? a : b; s += f(1); } return s; }
module.exports = { P, Q, WithStatics, Optional, K, fewer, fewer2, make, call };
