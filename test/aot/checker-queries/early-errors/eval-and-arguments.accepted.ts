// Names that TypeScript erases, checked or not.
declare class eval {} export {};
declare function arguments(): void; export {};
import { type eval } from "./a"; export {};
import type arguments from "./a"; export {};
⏎// @ts-nocheck⏎declare class eval {} export {};
⏎// @ts-nocheck⏎import { type eval } from "./a"; export {};
⏎// @ts-nocheck⏎import type arguments from "./a"; export {};
