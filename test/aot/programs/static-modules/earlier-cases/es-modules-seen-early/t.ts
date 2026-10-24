import { emit } from "./registry.cjs";
export const a: number = 1;
export function f(): string { return "f"; }
export const first: string = emit("in the middle");
export const b: number = first.length;
export var v: string = "v";
export const second: string = emit("at the end");
