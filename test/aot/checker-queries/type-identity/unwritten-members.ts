// The untyped identity of an object literal depends only on the names and kinds of its members. The identity of its type is the literal's own.
const o = { a: 1, b: "x", m() {} };
const p = { a: 1 };
const q = { get a() { return 1; } };
const r = { b: "y", m() {}, a: 2 };
export {};
