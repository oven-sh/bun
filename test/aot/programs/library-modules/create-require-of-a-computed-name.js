// What createRequire() returns follows the rules of require(name), and having it brings no library module in.
import "node:path";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);
for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof load(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
