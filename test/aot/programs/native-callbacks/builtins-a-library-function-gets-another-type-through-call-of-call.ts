// Built-ins applied by native code: the one call of url.format that the program spells out passes an object of its own; here Function.prototype.call is itself applied with call, and the library's own `typeof` tests must still see what really arrives.
import { format } from "node:url";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const honest = format({ protocol: "http", host: "localhost", pathname: "/a" });
console.log(honest, attempt(() => Function.prototype.call.call(format, null, 5)));
