import { requireLaterWithoutCode } from "./load.cjs";
console.log("shared starts");
console.log("shared sees:", requireLaterWithoutCode());
export const shared = 3;
console.log("shared ends");
