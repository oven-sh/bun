import { who } from "./dep.js";
import { slow } from "./slow.js";
import "./root.js";
console.log("SAID the member begins and reads", who(), slow);
export const atBody = who();
export const via = () => who();
