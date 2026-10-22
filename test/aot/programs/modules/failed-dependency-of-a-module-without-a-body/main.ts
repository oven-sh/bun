// A module that only declares functions and re-exports has nothing to run, so the compiled loader passes over it on the way to what it imports. One of those imports throws: the importer fails, a later import() of the modules in between, of the importer and of the module that threw rejects with that same error, and nothing runs twice.
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

const importer = await attempt("importer", () => import("./importer"));
const between = await attempt("in between", () => import("./between"));
const around = await attempt("around it", () => import("./around"));
const again = await attempt("importer again", () => import("./importer"));
const direct = await attempt("directly", () => import("./throws"));
console.log(importer === between, between === around, around === again, again === direct);
try {
  require("./between");
  console.log("required");
} catch (error) {
  console.log("require threw", error === direct);
}
await attempt("beside it", () => import("./beside"));
await attempt("fine", () => import("./fine"));
console.log(seen.join(", "));
