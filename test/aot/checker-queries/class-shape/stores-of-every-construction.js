// A stored member is not optional if every construction stores it: `this.name = v` that a statement of the constructor's body always evaluates, in front of the first `return` that can hand out `this`.
function Item(kind) {
  if (!(this instanceof Item)) return new Item(kind);
  this.kind = 1;
  this.first = this.last = 0;
  this.a = 2, this.b = 3;
  if (kind) this.parent = 4;
  this.parent = 5;
  if (kind) this.conditional = 6;
  { this.inBlock = 7; }
  kind && (this.behindTest = 8);
  this.lazy ||= 9;
  const later = () => { this.inArrow = 10; };
  const value = () => this.arrowResult = 11;
  if (kind === 0) return;
  this.afterReturn = 12;
}
function Replaced(flag) {
  if (flag) return { other: true };
  this.a = 1;
}
function Removed() {
  if (false) return;
  this.a = 1;
}
class Base {
  constructor(x) {
    this.x = 1;
    if (x) return this;
    this.y = 2;
  }
  m() { this.z = 3; }
  w = (this.v = 4);
}
class Derived extends Base {
  constructor() {
    super(0);
    this.d = 5;
  }
}
new Replaced(), new Removed();
