import { inner } from "./inner.mjs";
export const outer = () => "outer " + inner();
console.log("SAID outer ran", inner());
