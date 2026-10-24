import { useA } from "./b.mjs";
export function hoisted() { return "hoisted"; }
export var v = "var";
export let l = "let";
export class K {}
export default function named() { return "default fn"; }
console.log(useA());
