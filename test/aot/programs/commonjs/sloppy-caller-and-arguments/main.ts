// While a sloppy function runs, plain Bun hands out its caller and its arguments object through `f.caller` and `f.arguments`; a compiled program hands out neither and answers null. Stores to the two do nothing in both. For a strict function all of it throws in both.
import { reads, stores } from "./sloppy.cjs";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": " + f()); } catch (e: any) { console.log(label + ": " + e.name + ": " + e.message); }
}
function strict(): unknown { return (strict as any).caller; }
attempt("reads", reads);
attempt("stores", stores);
attempt("of a strict function", strict);
