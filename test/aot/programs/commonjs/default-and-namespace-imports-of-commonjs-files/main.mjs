// CommonJS files are imported by default, through a module that passes the default on, beside named imports and a require, and as a namespace that nothing reads.
import { createRequire } from "node:module";
import addThree from "./adds-three.cjs";
import { addThreeAgain } from "./passes-the-default-on.mjs";
import settings, { limit } from "./settings.cjs";
import * as unused from "./prints-when-it-runs.cjs";

const require = createRequire(import.meta.url);
console.log(addThree(4), addThreeAgain(5), addThree === addThreeAgain);
console.log(settings.limit, limit, require("./settings.cjs") === settings);
console.log(typeof addThree, addThree.name);
