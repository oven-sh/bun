function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
export function hoisted(object) { return object[kValue]; }
export const outcomeOfHoisted = outcome(() => hoisted({}));
const kValue = Symbol("value");
export const later = function later(object) { return object[kValue] === undefined ? 0 : object[kValue]; };
export const Kept = function Kept(value) { this[kValue] = value; this.count = 1; };
