declare const console: { log(...values: unknown[]): void };
import { next } from "./mods/one/index";
console.log(next({ n: 1 }));
