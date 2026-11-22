export * from "./m0.mjs";
export const v1 = "v1";
export function f1() { return this === undefined ? "f1" : Object.keys(this).length; }
