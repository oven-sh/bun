// The instantiations of one generic type literal are told apart by their type arguments: equal arguments are one identity wherever they are written.
type Box<T> = { value: T };
type Pair<A, B> = { first: A; second: B };
let v1: Box<number>;
let v2: Box<number>;
let v3: Box<string>;
let v4: Pair<number, string>;
let v5: Pair<string, number>;
let v6: Box<Box<number>>;
let v7: Box<Box<number>>;
export {};
