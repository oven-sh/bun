import { Vessel, hidden } from "./vessel.mjs";
const first = hidden(new Vessel(2));
console.log(first.describe());
const later = await import("./later.mjs");
const second = hidden(later.make(3));
console.log(second.describe(), second instanceof Vessel, new second.constructor(4).describe());
