import { total } from "./heavy.ts";
import { first } from "./first.ts";
import { make } from "./untyped.js";
export const typed = first(true);
export const untyped = make(true, "e");
export const sum = total;
