import { readA, fnB } from "./b.mjs"; export const early = [readA(), fnB()].join(); export const a = "a"; export class K {} export function hoisted() { return "hoisted"; } export var v = "var";
