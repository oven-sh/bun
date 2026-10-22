// The value of an import attribute that is a string literal.
import a from "node:fs" with { type: "json" };
export * from "node:fs" with { type: "json" };
export { readFile } from "node:fs" with { type: "json" };
