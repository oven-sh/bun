// A CommonJS module that threw is required again by a computed name, which loads it from the disk each time.
declare const console: { log(...values: unknown[]): void };
import "./user.cjs";
