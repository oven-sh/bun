import { low } from "./low.mjs";
import { other } from "./other.mjs";
console.log("SAID top runs");
export const top = () => `${low()} ${other()}`;
