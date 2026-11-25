// The require that createRequire() made names the file, and nothing loads it: a return at its top is no mistake.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
console.log(path.basename(require.resolve("./returns.cjs")));
