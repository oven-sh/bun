// A required module where it is seldom written: seen by a direct eval, across yields and awaits, in a switch, a loop, a field, a default, an assignment, before its constant is initialized; copies that are exported.
import * as loose from "./loose.js";
import { constant, twice, word, atLoad } from "./copies";
import * as copies from "./copies";
type Lib = typeof import("./lib");
async function waits() { const m = require("./lib") as Lib; await null; const { twice } = m; await null; return m.constant + twice(1) + (await import("./lib")).constant; }
function evalInTyped() { const m = require("./lib") as Lib; return eval("m.constant + 1"); }
async function evalOfAwaited() { const m = await import("./lib"); const { word } = await import("./lib"); return eval("m.constant + word"); }
console.log(loose.viaEval(), loose.viaEvalOfACopy(), loose.viaFunction(), [...loose.yields()].join(), loose.inASwitch(1), loose.inASwitch(2), loose.assigned(), loose.byDefault(), new loose.Fields().read(), loose.early(), loose.inALoop(), loose.labelled());
console.log(constant, twice(constant), word, atLoad, Object.keys(copies).join(), copies.twice(2), (() => word)());
console.log(await waits(), evalInTyped(), await evalOfAwaited());
