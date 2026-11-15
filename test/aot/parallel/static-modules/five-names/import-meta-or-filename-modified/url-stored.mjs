import { createRequire } from "node:module";
import.meta.url = new URL("./other/x.mjs", import.meta.url).href;
export default createRequire(import.meta.url)("./a.js");
