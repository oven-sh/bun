import { take } from "./keeps.js";
export const askWhole = () => take(import.meta.dirname + "/value.cjs");
export const askShort = () => take("./value.cjs");
