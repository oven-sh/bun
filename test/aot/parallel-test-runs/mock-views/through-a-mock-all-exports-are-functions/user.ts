import { outer } from "./outer";
import { v } from "./dep";
export function run() { return outer() + " " + v(); }
