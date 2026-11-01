import defer * as evenLater from "./between.mjs";
console.log("later.mjs runs");
export const read = () => evenLater.value;
