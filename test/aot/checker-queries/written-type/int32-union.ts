// `int32` is a member of a union like any other type. The checker joins it with nothing, not even with `number`.
import type { int32 } from "bun";
let a: int32 | number = 1;
let b: int32 | null = 1;
export {};
