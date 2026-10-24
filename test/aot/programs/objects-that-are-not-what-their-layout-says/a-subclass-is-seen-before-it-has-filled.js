// The constructor of the base class shows the object to a method of the class below before that class has stored its fields.
const seen = [];
class Base {
  constructor(kind) {
    this.kind = kind;
    this.flags = 1;
    this.start();
  }
  start() {}
}
class Below extends Base {
  constructor(kind, pos) {
    super(kind);
    this.pos = pos;
    this.end = pos + 1;
  }
  start() { seen.push(describe(this)); }
}
class WithFields extends Base {
  pos = 7;
  end = this.pos + 1;
  start() { seen.push(describe(this)); }
}
function Old(kind) {
  this.kind = kind;
  this.flags = 2;
  if (this.start) this.start();
}
class BelowOld extends Old {
  constructor(kind, pos) {
    super(kind);
    this.pos = pos;
    this.end = pos + 1;
  }
  start() { seen.push(describe(this)); }
}
function describe(node) {
  return node.kind + " " + node.flags + " " + node.pos + " " + node.end + " " + ((node.pos | 0) + (node.flags | node.kind)) + " " + Object.keys(node).join();
}
for (const Maker of [Base, Below, WithFields, Old, BelowOld]) {
  const made = [];
  for (let i = 0; i < 30; i++) made.push(new Maker(i, i * 2));
  let length = 0;
  for (const node of made) length += describe(node).length;
  console.log(Maker.name, length, describe(made[4]), "|", seen.length, seen[4]);
  seen.length = 0;
}
