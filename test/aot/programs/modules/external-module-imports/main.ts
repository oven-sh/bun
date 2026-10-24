// Six modules that import external modules (node:path, node:os, node:util, node:events) between, ahead of and behind imports of one another: the order in which the modules are
// evaluated is the order of the imports; an external module is fetched once for the program; a module that throws while it is evaluated throws the same error to whoever imports it next.
import { log } from "./log.ts";
import { basename } from "node:path";
import { first } from "./first.ts";
import { EOL } from "node:os";
import { second } from "./second.ts";
import { third } from "./third.ts";
log("main: " + basename("/a/b/main.ts") + " " + JSON.stringify(EOL.length > 0) + " " + first() + " " + second() + " " + third());
for (const round of [1, 2]) {
  try { const late = await import("./throws.ts"); log("no error " + late.never); } catch (error) { log("round " + round + ": " + (error as Error).message); }
}
const lazy = await import("./lazy.ts");
log("lazy: " + lazy.name());
console.log(log("done").join("\n"));
