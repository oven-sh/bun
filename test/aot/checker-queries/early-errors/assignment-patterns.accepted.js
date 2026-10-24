// Valid assignment patterns, and { a = 1 } as a pattern.
var a, b, c; [a, ...b] = c;
var a, b, c; ({ a, ...b } = c);
var a, c; [...[a]] = c;
var a = {}, c; ({ ...a.b } = c);
var a, c; ({ a = 1 } = c);
var a, c; [{ a = 1 }] = c;
var a, c; for ({ a = 1 } of c);
({ a = 1 }) => a;
