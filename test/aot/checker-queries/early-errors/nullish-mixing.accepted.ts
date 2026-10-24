// ?? next to || or && with parentheses, also under a type assertion. Checked or not.
var a: unknown, b: unknown, c: unknown, x: unknown; x = (a || b) ?? c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a ?? (b && c); export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = (a ?? b) || c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = (a || b)! ?? c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = (a ?? b) as unknown || c; export {};
var a: unknown, b: unknown, c: unknown, x: unknown; x = a ?? (b || c) as unknown; export {};
⏎// @ts-nocheck⏎var a, b, c, x; x = (a || b)! ?? c; export {};
