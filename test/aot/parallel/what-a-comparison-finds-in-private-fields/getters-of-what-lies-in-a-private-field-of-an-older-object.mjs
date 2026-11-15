// Guards: a class may lay its private field on an older object that its base hands back. There the field is a property under a private symbol, which Bun.deepMatch() listed by itself: it went into what lies there and ran getters that the compiler had proven nobody else calls.
class Base { get seen() { return this.tag; } }
class First extends Base { constructor() { super(); this.tag = "first"; } }
class Second extends Base { constructor() { super(); this.other = 41; this.tag = "second"; } }
class Lone { constructor() { this.tag = "lone"; } get only() { return this.tag + "!"; } }
class Hands { constructor(back) { return back; } }
class Holder extends Hands { #kept; constructor(kept) { super({}); this.#kept = kept; } }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return o.seen; }
function compare(pattern, value) {
  try { return String(Bun.deepMatch(new Holder(pattern), new Holder(value))); } catch (error) { return error.name; }
}
console.log(look(new First()));
console.log(compare({ only: "lone!" }, new Lone()));
console.log(compare({ seen: "second" }, new Second()));
