import { who } from "./dep.js";
import defer * as later from "./later.js";
console.log("SAID the importer begins and reads", who());
export const atBody = who();
export const via = () => who();
export const isDone = () => later.done;
