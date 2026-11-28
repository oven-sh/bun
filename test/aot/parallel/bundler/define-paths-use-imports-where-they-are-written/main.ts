// Flags: --define=config.renamed=inBrackets.value --define=config.outer=behindPath.value --define=config.outer.inner=5 --define=NAME=behindName --define=NAME.inner=6 --define=READ=used.value --define=LEVEL=local.level
// Reference: bun build --compile
import inBrackets from "./never.ts";
import behindPath from "./never.ts";
import behindName from "./never.ts";
import used from "./used.ts";

declare const config: any, NAME: any, READ: any, LEVEL: any;
(globalThis as any).config = { renamed: "own" };
const local = { get level() { console.log("read"); return 1; } };
typeof LEVEL;
const unused = typeof LEVEL;
console.log(config["renamed"], config.outer.inner, NAME.inner, READ);
