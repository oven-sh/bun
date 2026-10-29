// The `prototype` property of a constructor function is replaced by a store whose key is computed. What it now names has a setter for a name that the constructor fills,
// so the objects made from then on have no such property of their own: the setter takes the store and the getter answers the read.
const kept = [];
const spy = {
  set pos(value) {
    kept.push(value);
  },
  get pos() {
    return "read";
  },
};
function Made(pos, end) {
  this.pos = pos;
  this.end = end;
}
function storeUnder(target, key, value) {
  target[key] = value;
}
function posOf(made) {
  return made.pos;
}
let early = 0;
for (let i = 0; i < 50; i++) early += posOf(new Made({ tag: i }, i)).tag;
console.log("before", early);
storeUnder(Made, ["proto", "type"].join(""), spy);
const late = new Made({ tag: 1 }, 2);
const pos = posOf(late);
console.log("after", Object.hasOwn(late, "pos"), typeof pos, String(pos), late.end, kept.length);
