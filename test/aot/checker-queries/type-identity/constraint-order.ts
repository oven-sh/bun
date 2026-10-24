// The order of `Schema` constraints does not change an identity. The constraints themselves do.
import type { Schema } from "bun";
let v1: number & Schema.Min<1> & Schema.Max<9>;
let v2: number & Schema.Max<9> & Schema.Min<1>;
let v3: number & Schema.Min<1>;
let v4: number & Schema.Max<1>;
export {};
