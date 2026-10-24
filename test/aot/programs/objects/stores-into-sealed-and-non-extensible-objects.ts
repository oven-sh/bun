// A sealed or non-extensible object still takes stores into the fields it has. It refuses a new property, a deletion (sealed) and a redefinition (sealed); a frozen object refuses the store too.
"use strict";
class Sealed { x = 1; declare late?: number; }
class Closed { x = 1; declare late?: number; }
class Frozen { x = 1; declare late?: number; }
class Open { x = 1; declare late?: number; }
function storeSealed(object: Sealed, value: number) { object.x = value; }
function storeClosed(object: Closed, value: number) { object.x = value; }
function storeFrozen(object: Frozen, value: number) { object.x = value; }
function storeOpen(object: Open, value: number) { object.x = value; }
function addSealed(object: Sealed, value: number) { object.late = value; }
function addClosed(object: Closed, value: number) { object.late = value; }
function addOpen(object: Open, value: number) { object.late = value; }
function attempt(action: () => void) { try { action(); return "ok"; } catch (error) { return (error as Error).constructor.name; } }
const sealed = Object.seal(new Sealed());
const closed = Object.preventExtensions(new Closed());
const frozen = Object.freeze(new Frozen());
const open = new Open();
let line = "";
for (let round = 0; round < 300; round++) {
  line = [
    attempt(() => storeSealed(sealed, round)), sealed.x,
    attempt(() => storeClosed(closed, round)), closed.x,
    attempt(() => storeFrozen(frozen as Frozen, round)), frozen.x,
    attempt(() => storeOpen(open, round)), open.x,
    attempt(() => addSealed(sealed, round)), sealed.late,
    attempt(() => addClosed(closed, round)), closed.late,
    attempt(() => addOpen(open, round)), open.late,
    attempt(() => { delete (sealed as Partial<Sealed>).x; }), "x" in sealed,
    attempt(() => { Object.defineProperty(sealed, "x", { value: -1, configurable: true }); }), sealed.x,
    attempt(() => { Object.defineProperty(sealed, "x", { value: -2 }); }), sealed.x,
    Object.isSealed(sealed), Object.isExtensible(closed), Object.isFrozen(frozen), Object.isFrozen(sealed),
  ].join(" ");
}
console.log(line);
console.log(attempt(() => { delete (closed as Partial<Closed>).x; }), "x" in closed, attempt(() => storeClosed(closed, 5)), closed.x);
