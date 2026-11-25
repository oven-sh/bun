import { rate, fee } from "./fx.mjs";
console.log("tax runs", rate);
export const rate2 = () => rate + " " + fee();
export const name = "@made-up/tax";
