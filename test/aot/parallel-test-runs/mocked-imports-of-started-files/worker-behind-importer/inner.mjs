import { leaf } from "./leaf.mjs";
export const inner = () => "inner " + leaf();
console.log("SAID inner ran", leaf());
