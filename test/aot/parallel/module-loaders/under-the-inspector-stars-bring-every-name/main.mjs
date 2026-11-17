// Under --compile-inspector code that the build does not see may take the object of any file. A file that hands names on by a star was taken by nobody, so the build stopped ("nobody was seen to ask for all that `export *` brings it").
// Flags: --compile-inspector
import { one } from "./between.mjs";
console.log(one);
const text = "import(" + JSON.stringify(new URL("./between.mjs", import.meta.url).href) + ")";
const all = await (0, eval)(text);
console.log(Object.keys(all).join(), all.three, all.own, all.six);
