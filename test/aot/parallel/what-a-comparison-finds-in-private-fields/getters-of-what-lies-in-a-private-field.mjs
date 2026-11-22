// Guards: the comparison asks what lies in a private field for the names of the pattern, which runs its getters. The compiler counted on nothing in a private field ever leaving its class: the one getter was not compiled, the other was entered with a receiver that was proven never to come.
class Base { get seen() { return this.tag; } }
class First extends Base { constructor() { super(); this.tag = "first"; } }
class Second extends Base { constructor() { super(); this.other = 41; this.tag = "second"; } }
class Lone { constructor() { this.tag = "lone"; } get only() { return this.tag + "!"; } }
class Holder { #kept; constructor(kept) { this.#kept = kept; } }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return o.seen; }
function compare(pattern, value) {
  try { return String(Bun.deepMatch(new Holder(pattern), new Holder(value))); } catch (error) { return error.name; }
}
console.log(look(new First()));
console.log(compare({ only: "lone!" }, new Lone()));
console.log(compare({ seen: "second" }, new Second()));
