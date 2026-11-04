import { dep } from "./dep.js";
import "./between.js";
import { seen } from "typed";
console.log("own runs");
export const seenByProject = () => dep;
export const seenByPackage = seen;
