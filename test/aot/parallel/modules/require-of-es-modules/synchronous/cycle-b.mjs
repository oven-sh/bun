import { nameOfA } from "./cycle-a.mjs";
console.log("cycle-b runs");
export const b = "b before " + nameOfA();
