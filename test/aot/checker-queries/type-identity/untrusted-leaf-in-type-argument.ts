// The trust of a leaf is part of an identity: a type argument that a checked file declares and an equal one that only a `.d.ts` declares give two identities.
/// <reference path="./untrusted-leaf-in-type-argument.d.ts" />
enum E { A, B }
interface Box<T> { value: T }
let a: Box<E>;
let b: Box<F>;
let c: Box<E>;
export {};
