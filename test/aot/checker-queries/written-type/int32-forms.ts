// Every way to name `int32` from "bun" gives the type `int32`, a number with the constraint `Int32`: imports, aliases, `import("bun").int32`, `| undefined` and parentheses.
import type { int32 } from "bun";
import type { int32 as Whole } from "bun";
type Count = int32;
type Inline = import("bun").int32;
let a: int32 = 1;
let b: Whole = 1;
let c: Count = 1;
let d: Inline = 1;
let e: int32 | undefined;
function g(p: int32) {}
function r(): int32 { return 1; }
let q: (int32) = 1;
class K { field: int32 = 0; }
let k: K;
export {};
