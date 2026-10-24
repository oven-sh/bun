// A constructor returns early, throws, or lets others see its object before the last store.
const seen = [];
function describe(node) {
  return node.kind + " " + node.pos + " " + node.flags + " " + node.parent + " " + (node.kind | node.flags) + " " + Object.keys(node).join();
}
function Early(kind, pos) {
  this.kind = kind;
  if (kind % 5 === 3) return;
  this.pos = pos;
  this.flags = 0;
  this.parent = null;
}
function Thrower(kind, pos) {
  this.kind = kind;
  seen.push(this);
  if (kind % 5 === 3) throw new RangeError("at " + kind);
  this.pos = pos;
  this.flags = 0;
  this.parent = null;
}
function Shown(kind, pos) {
  this.kind = kind;
  this.pos = pos;
  seen.push(describe(this));
  this.flags = 0;
  this.parent = null;
}
function Replaced(kind, pos) {
  this.kind = kind;
  this.pos = pos;
  this.flags = 0;
  this.parent = null;
  if (kind % 5 === 3) return { kind: "another object" };
}
class Late {
  constructor(kind, pos) {
    this.kind = kind;
    this.report();
    this.pos = pos;
    this.flags = 0;
    this.parent = null;
  }
  report() { seen.push(describe(this)); }
}
for (const Maker of [Early, Thrower, Shown, Replaced, Late]) {
  const made = [];
  for (let i = 0; i < 20; i++) {
    try {
      made.push(new Maker(i, i * 2));
    } catch (error) {
      made.push(seen[seen.length - 1]);
    }
  }
  let length = 0;
  for (const node of made) length += describe(node).length;
  console.log(Maker.name, length, "|", describe(made[2]), "|", describe(made[3]), "|", describe(made[8]));
  console.log(seen.length, seen.length === 0 ? "nothing was seen" : typeof seen[3] === "string" ? seen[3] : describe(seen[3]));
  seen.length = 0;
}
