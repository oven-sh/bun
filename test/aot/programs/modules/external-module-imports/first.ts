import { join } from "node:path";
import { log } from "./log.ts";
import { inspect } from "node:util";
log("first is evaluated: " + join("a", "b") + " " + inspect({ a: 1 }));
export function first(): string { return join("first", "x"); }
