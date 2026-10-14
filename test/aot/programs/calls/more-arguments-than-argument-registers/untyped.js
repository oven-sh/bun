"use strict";
function call8(f) { return f(1, 2, 3, 4, 5, 6, 7, 8); }
function call9(f) { return f(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function call10(f) { return f(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
function call12(f, x) { return f(x, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, x); }
function method9(o) { return o.m(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function method12(o, x) { return o.m(x, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, x); }
function dotCall10(f, t) { return f.call(t, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
function nested9(f) { return f(f(1, 2, 3, 4, 5, 6, 7, 8, 9), 2, 3, 4, 5, 6, 7, 8, f(9, 8, 7, 6, 5, 4, 3, 2, 1)); }
function inHandler9(f) { try { return f(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return "caught " + e.constructor.name; } }
module.exports = { call8, call9, call10, call12, method9, method12, dotCall10, nested9, inHandler9 };
