import { outer } from "./outer.mjs";
import { started } from "./started_test.mjs";
export const all = () => [outer(), started()].join(", ");
export const later = () => import("./plugin.mjs");
console.log("SAID all ran");
