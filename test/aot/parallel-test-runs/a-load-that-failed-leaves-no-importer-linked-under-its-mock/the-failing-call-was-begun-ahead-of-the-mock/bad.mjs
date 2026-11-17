import { missing } from "./other.mjs";
globalThis.ran = (globalThis.ran ?? "") + "b";
export const bad = () => missing;
