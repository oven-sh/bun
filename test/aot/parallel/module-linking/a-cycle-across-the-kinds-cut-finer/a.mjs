import b from "./b.cjs"; export const a = "a"; export function hoisted() { return "h"; } export var v = "v"; export const fromB = b.seen;
