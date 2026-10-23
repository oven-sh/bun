// eval and arguments as a target under a type assertion, and the cases of eval-and-arguments.rejected.js in TypeScript, checked or not.
(eval as any) = 1; export {};
(<any>arguments) = 1; export {};
[eval!] = []; export {};
for ((arguments satisfies any) of []) {} export {};
export class eval {}
[arguments] = []; export {};
⏎// @ts-nocheck⏎(eval as any) = 1; export {};
⏎// @ts-nocheck⏎export class eval {}
⏎// @ts-nocheck⏎[arguments] = []; export {};
⏎// @ts-nocheck⏎import { a as eval } from "./a"; eval;
