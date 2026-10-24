export const EARLY = { at: "early" };
const back = require("./required-back");
export const SEEN = back.SNAPSHOT;
export const LATE = { at: "late" };
export function late() { return LATE.at; }
