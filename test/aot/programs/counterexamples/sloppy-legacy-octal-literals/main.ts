// `010`, `"\033["` and `08` in a sloppy CommonJS file that TypeScript imports.
declare const console: { log(...values: unknown[]): void };
import "./old.cjs";
