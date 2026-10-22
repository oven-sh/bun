// ?? next to || or && without parentheses where TypeScript's own check does not look: in an operand of = or of a comma. Checked or not.
var a: unknown, b: unknown, c: unknown, x: unknown; x = a || b ?? c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a && b ?? c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a ?? b && c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a ?? b || c; export {};
var a: unknown, b: unknown, c: unknown, d: unknown; a || b ?? c, d; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a || b! ?? c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a ?? b as unknown || c; export {};
x = a || b ?? c;
⏎// @ts-nocheck⏎var a, b, c, x; x = a || b ?? c; export {};
⏎// @ts-nocheck⏎var a, b, c, x; x = a ?? b || c; export {};
