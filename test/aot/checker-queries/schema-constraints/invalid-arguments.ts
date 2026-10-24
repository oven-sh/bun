// A `Schema` alias with an invalid argument is dropped, so the value is validated less, never wrongly.
import type { Schema } from "bun";
let v1: number & Schema.Min<number>;
let v2: string & Schema.MinLength<-1>;
let v3: string & Schema.MinLength<1.5>;
let v4: string & Schema.Format<"email" | "uuid">;
let v5: number & Schema.Int & Schema.Min<number>;
export {};
