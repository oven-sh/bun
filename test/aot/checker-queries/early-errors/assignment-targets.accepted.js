// Names, member accesses and patterns as the left side. Parentheses around a name or a member access are allowed.
var a; a = 1;
var a; (a) = 1;
var a = {}; (a.b) = 1;
var a = {}; a.b.c = 1;
var a = {}; a[0] = 1;
var a, b; [(a)] = b;
var b, c; ({ a: (b) } = c);
var a, b, c, d; [a = 1, [b], { c }] = d;
var a = {}; a.b ||= 1;
var a = {}; [a.b, a[0]] = [];
