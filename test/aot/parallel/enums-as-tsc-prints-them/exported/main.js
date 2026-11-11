// The object of another file: a store from a third file, Object.assign, and the namespace handed on to a function that changes what it finds there.
import { Marks as $, Kinds } from "./marks.js";
import { store, assign, throughNamespace } from "./changes.js";
function kind(c) {
  switch (c) {
    case $.End: return "end";
    case $.Tab: case $.Space: return Kinds.Gap;
    default: return Kinds.Word;
  }
}
function all() { return [kind(-1), kind(9), kind(10), kind(32), kind(33), kind(65)].join(); }
console.log(all(), Object.keys($).join());
for (let i = 0; i < 3000; i++) all();
store();
console.log(all());
assign();
console.log(all(), Object.keys($).join());
throughNamespace(space => { space.Marks.End = 65; space.Kinds.Gap = "hole"; });
console.log(all());
