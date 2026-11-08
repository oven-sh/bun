// The walked object is the namespace of a module.
import * as steps from "./steps.mjs";
let value = [1, 2];
for (const step in steps) value = value[step](steps[step]);
console.log(value);
