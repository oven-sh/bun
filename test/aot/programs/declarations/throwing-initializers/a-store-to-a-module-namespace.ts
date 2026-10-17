import * as self from "./a-throw-in-a-getter";
function fill(into: { tag: string }): { tag: string } { into.tag = "stored"; return into; }
export const made = fill(self);
