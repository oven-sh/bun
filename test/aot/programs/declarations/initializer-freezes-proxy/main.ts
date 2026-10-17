// Object.freeze of a Proxy runs its traps, or freezes its target, or throws: so a constant that is initialized that way is made where it is declared.
import { log } from "./log";
import { isTargetFrozen, readAll } from "./made";
log.push("loaded");
console.log(String(isTargetFrozen()), String(readAll()), log.join());
let loaded = false;
try {
  const module = await import("./throws");
  loaded = true;
  console.log(typeof module.refused);
} catch (error) {
  console.log((error as Error).name, loaded ? "when it was read" : "while it was loaded");
}
