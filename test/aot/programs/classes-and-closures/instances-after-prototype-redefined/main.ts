// A program defines an accessor or a read-only property on the prototype of a class. A store to `this` in the constructor then runs the setter, or throws: so a top-level constant that holds an object of the class is made where it is declared, not at its first read.
import { log } from "./log";
import { observed, readLater, redefineLater } from "./made";
log.push("loaded");
redefineLater();
console.log(JSON.stringify(observed), JSON.stringify(readLater()), log.join());
let loaded = false;
try {
  const module = await import("./throws");
  loaded = true;
  console.log(JSON.stringify(module.made));
} catch (error) {
  console.log((error as Error).name, loaded ? "when it was read" : "while it was loaded");
}
