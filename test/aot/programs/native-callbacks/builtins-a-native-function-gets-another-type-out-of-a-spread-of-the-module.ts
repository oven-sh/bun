// Built-ins applied by native code: every call of path.basename, a function out of a native binding, that the program spells out passes strings; here a copy of the module's exports holds it, and the function must still be there and refuse what is no string.
import path, { basename } from "node:path";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const honest = basename("/a/b.txt", ".txt");
console.log(honest, attempt(() => ({ ...path } as any).basename(5)));
