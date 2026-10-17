// A module that throws while it is evaluated runs once and throws the same error at every later import, directly, through another module, and inside an import cycle; modules that do not throw run once.
import { seen } from "./seen";

async function attempt(what: string, load: () => Promise<unknown>): Promise<unknown> {
  try {
    await load();
    console.log(what, "loaded");
    return undefined;
  } catch (error) {
    console.log(what, "threw", (error as Error).message);
    return error;
  }
}

const first = await attempt("first importer", () => import("./first-importer"));
const second = await attempt("second importer", () => import("./second-importer"));
const direct = await attempt("directly", () => import("./throws"));
console.log(first === second, second === direct);
const inCycle = await attempt("cycle, entered at a", () => import("./cycle-a"));
const again = await attempt("cycle, entered at b", () => import("./cycle-b"));
console.log(inCycle === again);
await attempt("fine", () => import("./fine"));
await attempt("fine again", () => import("./fine"));
console.log(seen.join(", "));
