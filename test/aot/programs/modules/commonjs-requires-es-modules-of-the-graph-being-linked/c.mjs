import late from "./late.cjs";
import { shared } from "./shared.mjs";
console.log("c runs");
export const c = "c(" + late + "," + shared + ")";
