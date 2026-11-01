// The build follows `load` to what it is made of, and finds a call of `load` there.
import { createRequire } from "node:module";
let seen;
try {
  const load = createRequire(load("node:url").fileURLToPath(import.meta.url));
  seen = typeof load;
} catch (error) {
  seen = error.name;
}
console.log(seen);
