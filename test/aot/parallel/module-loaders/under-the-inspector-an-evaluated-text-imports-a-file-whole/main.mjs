// Under --compile-inspector code that the build does not see may run: what is typed into the console, and a text that the program evaluates. It imports a compiled file by its URL.
// The program itself loads nothing under a name made at run time, so the build left out the export that nothing written reads: the namespace came without it, and nothing said so.
// Flags: --compile-inspector
import { used } from "./imported.mjs";
const text = "import(" + JSON.stringify(new URL("./imported.mjs", import.meta.url).href) + ")";
console.log(used(1), typeof (await (0, eval)(text)).unused);
