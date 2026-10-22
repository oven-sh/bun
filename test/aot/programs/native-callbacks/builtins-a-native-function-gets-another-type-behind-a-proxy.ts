// Built-ins applied by native code: every call of path.basename, a function out of a native binding, that the program spells out passes strings; here the proxy passes the arguments on, and the function must still be there and refuse what is no string.
import { basename } from "node:path";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const honest = basename("/a/b.txt", ".txt");
console.log(honest, attempt(() => (new Proxy(basename, {}) as any)(5)));
