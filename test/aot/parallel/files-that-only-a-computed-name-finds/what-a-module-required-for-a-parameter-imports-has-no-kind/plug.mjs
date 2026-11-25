import * as plain from "./plain.cjs";
export const kind = globalThis.madeUpKind;
export const shape = Object.keys(plain).join(",") + " " + Object.prototype.toString.call(plain);
