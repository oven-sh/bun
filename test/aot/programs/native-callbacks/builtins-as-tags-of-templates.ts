// Built-ins applied in an unusual form: as the tag of a template a function gets the array of strings, with its `raw` property, as its first argument, where its parameter says string, format or list.
import { format, inspect } from "node:util";
import { join } from "node:path/posix";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const results = [
  attempt(() => (format as any)`a${1}b${"x"}`),
  attempt(() => (inspect as any)`a${1}`),
  attempt(() => (Buffer.from as any)`ab${1}`.length),
  attempt(() => (join as any)`a${"b"}`),
  attempt(() => String.raw`a\n${1}`),
  attempt(() => (Array.from as any)`ab${undefined}`.length),
  attempt(() => (JSON.stringify as any)`a${null}${2}`),
  attempt(() => (Object.keys as any)`a${1}b`),
  attempt(() => (Array.of as any)`x${5}`.length),
  attempt(() => (structuredClone as any)`q`.raw),
];
console.log(results.join(" | "));
