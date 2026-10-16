import "./early.js";
export function readLate(object) { return object[kLate]; }
export const kLate = Symbol("late");
