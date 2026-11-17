export * from "./plain.mjs";
import * as middle from "./middle.cjs";
export const first = "first " + middle.text;
