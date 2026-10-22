// Built-ins applied by native code: every call of path.basename, a function out of a native binding, that the program spells out passes strings; here the bound function passes the bound argument, and the function must still be there and refuse what is no string.
import { basename } from "node:path";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const honest = basename("/a/b.txt", ".txt");
console.log(honest, attempt(() => basename.bind(null, 5 as any)()));
