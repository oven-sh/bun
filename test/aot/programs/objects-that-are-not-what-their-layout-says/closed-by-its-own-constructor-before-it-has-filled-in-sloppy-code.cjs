// A constructor closes or freezes its object in the middle: the stores behind it create nothing. In sloppy code, where a refused store is silent.
function Closed(kind, pos) {
  this.kind = kind;
  Object.preventExtensions(this);
  this.pos = pos;
  this.flags = 0;
}
function Frozen(kind, pos) {
  this.kind = kind;
  this.pos = pos;
  Object.freeze(this);
  this.pos = pos + 1;
  this.flags = 0;
}
function describe(node) {
  return node.kind + " " + node.pos + " " + node.flags + " " + (node.kind | node.flags) + " " + Object.keys(node).join();
}
const halfMade = [];
function Shown(kind, pos) {
  halfMade.push(this);
  this.kind = kind;
  Object.preventExtensions(this);
  this.pos = pos;
  this.flags = 0;
}
for (const Maker of [Closed, Frozen, Shown]) {
  const made = [];
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    try {
      made.push(new Maker(i, i * 2));
    } catch (error) {
      refused++;
    }
  }
  const seen = made.length ? made : halfMade;
  let length = 0;
  for (const node of seen) length += describe(node).length;
  console.log(Maker.name, refused, seen.length, length);
  if (seen.length) console.log(describe(seen[3]), "flags" in seen[3]);
  Maker.prototype.flags = 16;
  if (seen.length) console.log(describe(seen[3]));
}
