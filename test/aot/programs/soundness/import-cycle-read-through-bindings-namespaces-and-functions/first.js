import { log } from "./log.js";
import "./second.js";
export var hoisted = 1;
export let scoped = 2;
export const fixed = 3;
export class Kind { static n = 4; }
export function declared() { const t = hoisted; return t === undefined ? "missing" : t + 1; }
export function readsScoped() { return scoped + 1; }
export default function () { return fixed + 1; }
export let changed = 5;
export function change() { changed = "five"; }
export { hoisted as renamed };
log.push("first ran");
