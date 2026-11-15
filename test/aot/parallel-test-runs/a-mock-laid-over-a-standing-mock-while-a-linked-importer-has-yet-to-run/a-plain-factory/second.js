import { who } from "./dep.js";
console.log("SAID second runs and reads", who);
export const seen = () => who;
