// A compiled class has a class shape; a class only a type edge reaches is an object.
import type { Other } from "./only-types";
class C { x = 1; self(): this { return this; } }
let v1: C;
let v2: typeof C;
let v3: Other;
