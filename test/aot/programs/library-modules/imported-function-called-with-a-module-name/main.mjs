// A string that happens to be the name of a built-in module keeps nothing unless the function it is passed to is a module loader. An export that is reassigned is not followed.
import { log, swap, swapped } from "./log.mjs";

log("dgram");
for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
try {
  console.log(typeof swapped("repl"));
} catch (error) {
  console.log(error.code);
}
swap();
swapped("repl");
