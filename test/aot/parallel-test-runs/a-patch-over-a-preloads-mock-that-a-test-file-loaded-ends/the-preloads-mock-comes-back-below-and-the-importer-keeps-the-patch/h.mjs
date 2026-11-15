import { createRequire } from "node:module";
import { word } from "./g.cjs";
const g = createRequire(import.meta.url)("./g.cjs");
export const read = () => word + "/" + g.word;
