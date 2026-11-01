// Function declarations whose names are assigned to, reached by a module that runs before theirs in every way that is no plain read of the name: through the namespace object, by reflection, in patterns, as callees of every kind.
import { early } from "./other.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
export function k(p) { return "k" + p + (new.target ? "new" : ""); }
export function setK(v) { k = v; }
export function orK(v) { k ||= v; k &&= k; k ??= v; return k; }
export async function later() { return "later"; }
export function setLater(v) { later = v; }
export function* gen() { yield "gen"; }
export function setGen(v) { gen = v; }
function hidden() { return "hidden"; }
export function callHidden() { return hidden(); }
export function setHidden(v) { hidden = v; }
export function same() { return [h, k, later, gen, hidden]; }
export default function named() { return "default"; }
export function setNamed(v) { named = v; }
console.log(early.join("\n"));
console.log("in main:", h(), k(1), typeof later, typeof gen, callHidden(), named());
