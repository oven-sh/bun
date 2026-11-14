import { step } from "./dep.mjs";
export let count = 5;
export let text = "lib text";
export let record = { name: "lib record" };
export let ratio = 1.5;
export let flag = true;
export let total = 0;
export function add(n) { total += n * step; return total; }
export function twice(n) { return n * 2; }
export class Box { constructor(value) { this.value = value; } }
export function change() { count++; text += "!"; ratio += 0.5; flag = !flag; record = { name: "new record " + count }; }
