// `f.caller` and `f.arguments` of a sloppy function answer under plain Bun; a compiled function has neither, and the TypeError says that --aot is why. For a strict function both throw the same error.
import { reads, stores } from "./sloppy.cjs";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": " + f()); } catch (e: any) { console.log(label + ": " + e.name + ": " + e.message); }
}
function strict(): unknown { return (strict as any).caller; }
attempt("reads", reads);
attempt("stores", stores);
attempt("of a strict function", strict);
