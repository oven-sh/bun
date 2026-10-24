// The attributes of an import type. bun run skips that text, so a value that is not a string literal is not an early error.
export type T = import("node:fs", { with: { "resolution-mode": T } });
// `assert` in the place of `with` is an error of TypeScript. bun run accepts it.
import a from "node:fs" assert { type: "json" };
export * from "node:fs" assert { type: "json" };
