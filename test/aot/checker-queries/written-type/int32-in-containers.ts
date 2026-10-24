// `int32` is a type, so a container keeps it: the element of an array, a type argument and the member it instantiates are `int32`.
import type { int32 } from "bun";
let a: int32[] = [];
let b: Map<string, int32>;
interface Box<T> { v: T }
let c: Box<int32>;
export {};
