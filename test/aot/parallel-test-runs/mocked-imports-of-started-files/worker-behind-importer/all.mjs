import { second } from "./second.mjs";
import { started } from "./started.mjs";
import { outer } from "./outer.mjs";
export const all = () => [second(), started(), outer()].join(", ");
export const later = () => import("./plugin.mjs");
console.log("SAID all ran");
