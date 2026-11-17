import { started } from "./started.mjs";
import { read } from "./mocked.mjs";
export const all = () => [started(), read()].join(", ");
export const later = () => import("./plugin.mjs");
console.log("SAID all ran");
