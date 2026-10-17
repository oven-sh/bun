import { makeSlot, getState, makeList, makeMap, describe } from "./lib.ts";
export function fill(owner, name) { const slot = makeSlot(); slot.name = name; slot.owner = owner; return slot; }
export function fillBoth(a, b) { const one = makeSlot(), two = makeSlot(); one.owner = a; two.owner = b; one.name = two.name = "n"; return [one, two]; }
export function state(winner, flag) { const s = getState(); s.winner = winner; s.rule = { flag }; s.count = s.count + 1; return s; }
export function either(c, owner) { const slot = c ? makeSlot() : getState().spare; slot.owner = owner; return slot; }
export function reads() { const slot = makeSlot(); return [slot.name, slot.owner, "name" in slot, Object.keys(slot).join()]; }
export function list(x) { const a = makeList(); a.push(x); a[1] = x; return a; }
export function map(k, v) { const m = makeMap(); m.set(k, v); return m; }
export function extra(x) { const slot = makeSlot(); slot.other = x; return describe(slot) + "," + slot.other; }
export function wrong(x) { const slot = makeSlot(); slot.name = x; return slot.name; }
