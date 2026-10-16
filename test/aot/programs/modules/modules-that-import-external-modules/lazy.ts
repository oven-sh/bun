import { log } from "./log.ts";
import { relative } from "node:path";
import { second } from "./second.ts";
log("lazy is evaluated");
export function name(): string { return relative("/a", "/a/lazy") + " " + second(); }
