// A program's own `type int32 = number` is a plain `number`: only `int32` from "bun" has the constraint.
type int32 = number;
let a: int32 = 1;
export {};
