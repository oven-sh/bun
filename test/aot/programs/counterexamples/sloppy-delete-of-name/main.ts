// `delete x` in a sloppy CommonJS file that TypeScript imports.
declare const console: { log(...values: unknown[]): void };
import "./sloppy.cjs";
