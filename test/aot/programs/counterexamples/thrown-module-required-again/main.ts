// A CommonJS module that threw is required again: it is evaluated again, as under `bun run`.
declare const console: { log(...values: unknown[]): void };
import "./user.cjs";
