import { early, look } from "./reader.ts";
export let current: { x: number } = { x: 1 };
export var hoisted: { x: number } = { x: 2 };
console.log(early, look());
