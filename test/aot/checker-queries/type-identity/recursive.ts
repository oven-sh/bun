// Computing the identity of a recursive type terminates, and distinct types get distinct identities.
type N<T> = { inner: N<T[]> | null };
type F = (next: F) => void;
type G = (next: G) => number;
let v1: N<number>;
let v2: N<string>;
let v3: F;
let v4: G;
function f(): { g: typeof f } { return { g: f }; }
function h(): { g: typeof h; x: 1 } { return { g: h, x: 1 }; }
export {};
