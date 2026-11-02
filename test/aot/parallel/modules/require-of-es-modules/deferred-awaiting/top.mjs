import { plain } from "./plain.mjs";
import { awaited } from "./awaits.mjs";
console.log("deferred-awaiting/top runs");
export const value = plain + " and " + awaited;
