// Reference: bun build --compile
import { E } from "./lists-one-file/index.ts";
import { F } from "./lists-none/index.ts";
console.log(E.A, F.A, JSON.stringify((globalThis as any).ran));
