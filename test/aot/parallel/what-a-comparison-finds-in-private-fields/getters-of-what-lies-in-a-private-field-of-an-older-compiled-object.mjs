// Guards: the older object that a class lays its private field on may be an object of another compiled class: the field lies beside its own fields then, and Bun.deepMatch() was shown it there.
class Base { get seen() { return this.tag; } }
class First extends Base { constructor() { super(); this.tag = "first"; } }
class Second extends Base { constructor() { super(); this.other = 41; this.tag = "second"; } }
class Lone { constructor() { this.tag = "lone"; } get only() { return this.tag + "!"; } }
class Hands { constructor(back) { return back; } }
class Older { constructor() { this.shown = 1; } }
class Holder extends Hands { #kept; constructor(kept) { super(new Older()); this.#kept = kept; } }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return o.seen; }
function compare(pattern, value) {
  try { return String(Bun.deepMatch(new Holder(pattern), new Holder(value))); } catch (error) { return error.name; }
}
console.log(look(new First()));
console.log(compare({ only: "lone!" }, new Lone()));
console.log(compare({ seen: "second" }, new Second()));
