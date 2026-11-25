export * from "./m1.mjs";
export const v2 = "v2";
export function f2() { return this === undefined ? "f2" : Object.keys(this).length; }
