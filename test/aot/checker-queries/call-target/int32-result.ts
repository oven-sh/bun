// A written `int32` result keeps its refinement.
import type { int32 } from "bun";
function f(): int32 { return 1; }
f();
