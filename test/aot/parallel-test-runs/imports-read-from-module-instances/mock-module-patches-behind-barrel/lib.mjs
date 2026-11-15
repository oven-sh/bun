import { step } from "./dep.mjs";
export const base = 7;
export let total = 0;
export let later;
export function add(n) { total += n * step; return total; }
export function twice(n) { return n * 2; }
export function setLater(value) { later = value; }
export class Box { constructor(value) { this.value = value; } }
export default function named() { return "default"; }
globalThis.ran = (globalThis.ran ?? "") + "lib,";
