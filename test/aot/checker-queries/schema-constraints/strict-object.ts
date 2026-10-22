// `Schema.Strict` is a constraint on an object type.
import type { Schema } from "bun";
let v1: { id: number } & Schema.Strict;
export {};
