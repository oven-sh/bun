// An instantiated generic interface is identified by the interface and its type arguments, not by its structure.
interface Pair<T> { first: T; second: T }
let v1: Pair<number>;
let v2: { first: number; second: number };
let v3: Pair<number>;
let v4: Pair<string>;
export {};
