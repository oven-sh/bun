import { log } from "./log.mjs";
import { left } from "./left.mjs";
import { right } from "./right.mjs";
log("with-imports runs");
export const sum = left + right;
