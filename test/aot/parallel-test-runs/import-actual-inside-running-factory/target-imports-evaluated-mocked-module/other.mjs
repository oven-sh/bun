import { x, count } from "./k.mjs";
globalThis.log.push("other");
export const sees = () => x;
export const counts = () => count();
