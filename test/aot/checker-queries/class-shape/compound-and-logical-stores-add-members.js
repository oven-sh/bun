// A store of any form adds a member. What `+=` stores is computed, so only a store of another form says a type.
class C {
  constructor() {
    this.total += 1;
    this.cache ||= "c";
    this.fallback ??= 2;
    this.flag &&= 3;
    this.early -= 1;
    this.early = 4;
  }
  m() {
    this.late *= 2;
  }
  static s() {
    this.calls += 1;
    this.label ||= "l";
  }
}
C.count += 1;
C.kind ??= "k";
function F() {
  this.a = 1;
  this.n += 1;
  this.o ||= 2;
}
F.prototype.shared ||= 5;
F.prototype.text += function () {};
F.prototype.made ??= function () {};
function G() {
  this.a = 1;
}
G.prototype ||= { never() {} };
function update() {
  this.n += 1;
  this.o ||= 2;
}
