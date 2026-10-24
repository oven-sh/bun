// A `Schema` alias under a second name is the same constraint: the type literal that declares the tag decides, not the name the type is written with.
import type { Schema } from "bun";
type Positive = Schema.Min<1>;
type AtLeast<N extends number> = Schema.Min<N>;
let v1: number & Positive;
let v2: number & AtLeast<3>;
export {};
