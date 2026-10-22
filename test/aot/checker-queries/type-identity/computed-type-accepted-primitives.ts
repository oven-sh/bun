// A computed object type is described by its structure, and the primitives it accepts are part of that: a string has a `length` that is a number.
const { skipped: s1, ...a } = { skipped: true, length: 1 };
const { skipped: s2, ...b } = { skipped: true, length: "s" };
let v1: typeof a;
let v2: typeof b;
export {};
