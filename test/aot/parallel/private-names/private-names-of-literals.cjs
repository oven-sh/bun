// `#name in {}`: an object literal that nobody has seen has no private name; one that a constructor has seen may have it.
// COUNT: operation:operationAOTPrivateHas <= 7000
"use strict";
class Returned { constructor(value) { return value; } }
class Stamped extends Returned { #mark = 1; #count = 0; static is(value) { return #mark in value; } static counted(value) { return #count in value ? ++value.#count : -1; } constructor(value) { super(value); } }
class Own { #name; #list = []; static is(value) { return #name in value; } static has(value) { return #list in value; } static literal() { return #name in {}; } static filled(k) { return #name in { k, name: k }; } static held(k) { const o = { k }, holder = { o }, list = [o]; new Stamped(k % 2 ? holder.o : list[0]); return [#name in o, Stamped.is(o), Stamped.is(list[0])]; } static stamped(k) { const o = { k }; new Stamped(o); return [#name in o, Stamped.is(o), Stamped.counted(o)]; } }
class Inner extends Own { #name = 2; static own(value) { return #name in value; } }
function once(k) {
  const kept = { k };
  const before = Stamped.is(kept);
  const stamped = new Stamped(kept);
  const twice = (() => { try { new Stamped(kept); return "stamped twice"; } catch (error) { return error.constructor.name; } })();
  return [
    Own.is({}), Own.is({ k }), Own.has({}), Own.is(new Own()), Own.has(new Own()), Own.literal(), Own.filled(k), Own.stamped(k), Own.held(k), Inner.own(new Inner()), Inner.own(new Own()), Inner.own({}), Own.is(new Inner()),
    before, Stamped.is(kept), stamped === kept, twice, Stamped.counted(kept), Stamped.counted(stamped), Stamped.is({}), Stamped.is(new Stamped({})), Stamped.is([]), Stamped.is(() => k), Stamped.is({ __proto__: kept }), Stamped.is(Object.create(kept)), Stamped.is({ ...kept }),
  ];
}
let text = "";
for (let k = 0; k < 500; k++) { const next = once(k % 3).join(); if (next !== text) console.log(text = next); }
for (const wrong of [1, "s", null, undefined, Symbol.iterator]) { try { console.log(Own.is(wrong)); } catch (error) { console.log(error.constructor.name); } }
