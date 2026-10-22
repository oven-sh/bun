// The value of an import attribute that is not a string literal: a number, a template literal, a string literal in parentheses.
import a from "node:fs" with { type: 1 };
import a from "node:fs" with { type: `json` };
import a from "node:fs" with { type: ("json") };
export * from "node:fs" with { type: 1 };
export { readFile } from "node:fs" with { type: 1 };
