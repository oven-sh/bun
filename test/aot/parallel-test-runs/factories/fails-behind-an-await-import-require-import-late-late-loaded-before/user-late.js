import { flag } from "./dep.js";
globalThis.usersThatRan = (globalThis.usersThatRan ?? 0) + 1;
export const values = () => flag;
