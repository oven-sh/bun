import { seenEarly, look } from "./second.mjs";
export const table = { a: 1 };
export const helper = () => 5;
export class Thing { n = 1; }
export let counter = 1;
export var loose = [1];
export function declared() { return "declared"; }
export default { kind: "default" };
counter = 2;
export function report() { return [...seenEarly, ...look("late")]; }
