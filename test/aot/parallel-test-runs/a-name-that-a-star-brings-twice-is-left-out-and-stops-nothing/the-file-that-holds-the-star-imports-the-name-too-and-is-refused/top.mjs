export * from "./outer.mjs";
import { round } from "./outer.mjs";
export const seen = typeof round;
