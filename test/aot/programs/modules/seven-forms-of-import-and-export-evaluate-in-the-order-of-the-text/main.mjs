// Seven forms of import and export evaluate in the order of the text.
console.log("main body");
import "./a.mjs";
export * from "./b.mjs";
import {} from "./c.mjs";
export {} from "./d.mjs";
import * as unused from "./e.mjs";
import "./a.mjs";
