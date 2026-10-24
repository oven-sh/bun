// `first` and `second` import each other. `second` runs to its end, then `first` throws. A module of a cycle is evaluated for good only when the module of the cycle that was entered first is: both have failed, with one error, and neither runs again. What `second` imports from outside the cycle is evaluated and stays so.
// STATISTIC: ModulesWithState >= 2
import { seen } from "./seen";

async function attempt(what: string, load: () => Promise<object>): Promise<unknown> {
  try {
    console.log(what, "loaded", Object.keys(await load()).join());
    return undefined;
  } catch (error) {
    console.log(what, "threw", (error as Error).message);
    return error;
  }
}

const first = await attempt("first", () => import("./first"));
const second = await attempt("second", () => import("./second"));
const again = await attempt("first again", () => import("./first"));
console.log(first === second, second === again);
await attempt("outside", () => import("./outside"));
console.log(seen.join(", "));
