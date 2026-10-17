import { format } from "node:util";
import { platform } from "node:os";
import { sep } from "node:path";
import { log } from "./log.ts";
log("third is evaluated: " + format("%s-%d", "n", 3) + " " + (platform().length > 0) + " " + sep.length);
export function third(): string { return format("%s", "third"); }
