import inner from "./inner.cjs";
import late from "./late.cjs";
console.log("shared runs");
export const shared = "shared(" + inner + "," + late + ")";
