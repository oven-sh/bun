import { requireWithoutCode } from "./load.cjs";
console.log("first starts");
console.log("first sees:", requireWithoutCode());
export const first = 1;
console.log("first ends");
