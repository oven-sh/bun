import { flag, fn } from "./dep.cjs";
console.log("SAID body of late");
export const late = () => flag + "/" + fn?.();
