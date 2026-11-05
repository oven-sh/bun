declare const console: { log(...values: unknown[]): void };
import { four, shape } from "../lib/index";
import { name, twice } from "@/util";
console.log(name, twice("ab"), four(), shape().m);
