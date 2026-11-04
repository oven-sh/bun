const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
import "./real.cjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log("imported-and-asked-through-create-require:", show(require.cache[require.resolve("./real.cjs")]));
