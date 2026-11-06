import { stage } from "./dynamic-cycle-a.mjs";
console.log("dynamic-cycle-b runs", stage);
export const saw = stage;
