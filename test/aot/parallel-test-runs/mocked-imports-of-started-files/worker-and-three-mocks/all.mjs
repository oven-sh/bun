import { read } from "./mocked.mjs";
import { started } from "./started.mjs";
export const all = () => [read(), started()].join(", ");
export const later = () => import("./plugin.mjs");
console.log("SAID all ran");
