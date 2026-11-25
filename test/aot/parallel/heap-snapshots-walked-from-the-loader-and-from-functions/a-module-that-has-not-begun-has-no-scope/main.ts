// A module that import() loads later shows nothing until then.
import { variablesOfLoadedModules } from "./walk";
console.log("in front:", variablesOfLoadedModules(["shelf", "ledger"]));
const { use, fill } = await import("./store");
fill("one");
console.log("a", use());
console.log("behind:", variablesOfLoadedModules(["shelf", "ledger"]));
