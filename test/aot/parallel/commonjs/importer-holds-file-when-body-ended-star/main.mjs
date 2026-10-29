// service.cjs goes on storing under its names in jobs that it queued while its body ran. An ES importer that has the names through `export *` holds what the file had when its body ended.
import { ready, steps } from "./through-a-star.mjs";
import { service } from "./through-a-namespace.mjs";

console.log(ready, steps, service.ready, service.steps);
setTimeout(() => console.log(ready, steps, service.ready, service.steps, require("./service.cjs").steps));
