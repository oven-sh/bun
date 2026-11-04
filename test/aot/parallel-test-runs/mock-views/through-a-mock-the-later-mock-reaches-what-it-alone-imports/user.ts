import { outer } from "./outer";
import { v } from "./dep";
export const run = () => outer() + " " + v;
