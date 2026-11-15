export * from "./m2.mjs";
export const v3 = "v3";
export function f3() { return this === undefined ? "f3" : Object.keys(this).length; }
