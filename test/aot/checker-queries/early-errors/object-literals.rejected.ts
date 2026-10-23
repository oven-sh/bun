// Malformed properties that TypeScript's parser reads, in files that are not type checked. Each is the only odd syntax of its file.
⏎// @ts-nocheck⏎var a, b; ({ [a, b]: 1 });
⏎// @ts-nocheck⏎({ a?: 1 });
⏎// @ts-nocheck⏎({ a!: 1 });
// A second __proto__: value after two properties at which TypeScript's own check of repeated names returns.
⏎// @ts-nocheck⏎var x, y; ({ get a() { return 1; }, a: 2, __proto__: x, __proto__: y });
// The same literal in a type-checked file.
var x, y; ({ get a() { return 1; }, a: 2, __proto__: x, __proto__: y }); export {};
