// A type literal is a declaration with one order of members. Two type literals have two identities, whether they list the same members in another order or in the same one. The order of `Schema` constraints is in the shape and not in the identity.
import type { Schema } from "bun";
let v1: { a: number; b: string };
let v2: { b: string; a: number };
let v3: { a: number; b: string };
let v4: number & Schema.Min<1> & Schema.Max<9>;
let v5: number & Schema.Max<9> & Schema.Min<1>;
let v6: { p: { a: number; b: string } };
let v7: { p: { b: string; a: number } };
export {};
