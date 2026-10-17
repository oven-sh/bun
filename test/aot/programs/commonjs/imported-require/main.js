// An ES module imports a binding named `require`, which must not be mistaken for CommonJS's `require`.
import { require } from "./files/mine.mjs";
console.log("an imported require: " + require("./files/lib.cjs").a);
