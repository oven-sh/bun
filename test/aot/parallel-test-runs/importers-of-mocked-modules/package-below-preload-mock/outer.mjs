import { inner } from "./inner.mjs";
console.log("SAID outer runs");
export const outer = () => inner();
