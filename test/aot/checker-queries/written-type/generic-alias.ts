// A generic alias instantiated with `int32` gives `int32`.
import type { int32 } from "bun";
type Id<T> = T;
let a: Id<int32> = 1;
export {};
