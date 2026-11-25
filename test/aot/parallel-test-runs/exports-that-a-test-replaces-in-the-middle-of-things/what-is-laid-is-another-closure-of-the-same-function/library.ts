import { makeCounter, makeNamer } from "./maker";
export function add(a: number, b: number): number { return a + b; }
export const counter = makeCounter(10);
export const namer = makeNamer("of the file");
let calls = 0;
export const counted = (): number => ++calls;
