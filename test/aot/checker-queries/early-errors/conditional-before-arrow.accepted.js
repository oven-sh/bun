// JavaScript has no return types: the colon behind a parenthesized expression is that of the conditional around it.
var a, b, c, d; a ? b ? (c, d) : e => e : 5;
var a, b, c; a ? b ? (c) : e => e : 5;
var a, b, c, d; a ? b ? (c = 1, d) : e => e : 5;
var a, b, c, async; a ? b ? async (c) : e => e : 5;
var a, b, c; a ? b ? x => (c) : e => e : 5;
var a, c; a ? (c) : e => e;
var a, c; switch (a) { case (c): e => e; }
var p, a, b, c, x; p ? a ? b ? x : (c) : e => e : 5;
