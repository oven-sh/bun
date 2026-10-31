// A `--define` whose value names a declaration that makes no variable reads the global of that name: `declare`, a type alias, an interface, a namespace without values and an import of a type leave nothing in the file to read.
// Flags: --define A=ambient --define B=alias --define C=shape --define D=space --define E=declared --define F=imported --define G=flags
import type { PathLike as imported } from "node:fs";
declare const A: string, B: string, C: string, D: string, E: string, F: string, G: string;
const globals = globalThis as any;
for (const name of ["ambient", "alias", "shape", "space", "declared", "imported", "flags"]) {
  globals[name] = "the global " + name;
}
declare const ambient: string;
type alias = string;
interface shape {}
namespace space {
  export type Inner = string;
}
declare function declared(): void;
declare const enum flags {
  On,
}
function read(path: imported): string {
  return [A, B, C, D, E, F, G, typeof path].join(", ");
}
console.log(read("a path"));

export {};
