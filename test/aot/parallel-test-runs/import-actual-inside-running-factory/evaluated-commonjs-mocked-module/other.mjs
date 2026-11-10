import { x, count } from "./k.cjs";
globalThis.log.push("other");
export const sees = () => x;
export const counts = () => count();
