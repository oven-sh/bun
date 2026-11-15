import { flag } from "./dep.cjs";
globalThis.usersThatRan = (globalThis.usersThatRan ?? 0) + 1;
export const values = () => flag;
