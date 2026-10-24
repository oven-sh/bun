// A type argument without a shape is an unknown part of the identity. The type that holds it still has one.
interface Box<T> { value: T }
let a: Box<Missing>;
let b: Box<Missing>;
let c: Box<number>;
export {};
