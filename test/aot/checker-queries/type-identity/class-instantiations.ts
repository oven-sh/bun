// Instantiations of a generic class share an identity, unless they accept different primitives.
class Box<T> { constructor(public value: T) {} }
class Wrapper<T> { valueOf(): T { throw new Error(); } }
let v1: { p: Box<number> };
let v2: { p: Box<string> };
let v3: { p: Wrapper<number> };
let v4: { p: Wrapper<string> };
export {};
