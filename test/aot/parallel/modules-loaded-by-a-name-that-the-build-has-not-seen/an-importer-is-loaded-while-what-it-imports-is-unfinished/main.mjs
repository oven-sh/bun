// m.mjs loads n.mjs by a name that no build can know, in front of its own `late`. n.mjs imports `late`: the loader finds m.mjs begun and passes it by, so n.mjs reads an empty binding.
import { late, seen } from "./m.mjs";
console.log("main:", late.x > 0, seen());
if (process.argv.length > 100) console.log(await import("./n.mjs"));
