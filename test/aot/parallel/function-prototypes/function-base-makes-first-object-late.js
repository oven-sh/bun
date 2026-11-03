// A constructor function above others gets its class when one of those below makes its first object. Its own first object may come much later, or never.
// Whatever happens to it in between is seen from below at once, and by its own objects when they come.
var unseen = new Function("x", "return x");
var lines = [];
function ABase(n) { this.n = n; }
ABase.prototype.who = function () { return "base"; };
ABase.prototype.size = function () { return this.n; };
ABase.prototype.both = function () { return this.who() + this.size(); };
ABase.fixed = function () { return "fixed"; };
function AMiddle(n) { ABase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(AMiddle.prototype, ABase.prototype);
AMiddle.prototype.mid = function () { return "mid" + this.m; };
function ALeaf(n) { AMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(ALeaf.prototype, AMiddle.prototype);
ALeaf.prototype.leaf = function () { return "leaf" + this.l; };
class AClass extends AMiddle { own() { return "own" + this.m; } }
function Aask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("A " + label + ": " + answers);
}
var Aobjects = [new ALeaf(1), new AClass(2)];
Aask("from below", Aobjects);
Aask("nothing changes", Aobjects);
Aobjects.push(new ALeaf(3), new AClass(4));
Aask("more from below", Aobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Ai = 0; Ai < 4; Ai++) { var Amade = Ai & 1 ? new ABase(10 + Ai) : new AMiddle(10 + Ai); lines.push("A made " + Amade.who() + Amade.size() + Amade.both() + " " + Object.keys(Amade).join("")); Aobjects.push(Amade); }
Aask("with their own objects", Aobjects);
Object.defineProperty(unseen(ABase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Aask("changed behind their first objects", Aobjects);
lines.push("A " + ABase.fixed() + " " + (Aobjects[0] instanceof ABase) + " " + (Aobjects[5] instanceof ABase) + " " + Object.getPrototypeOf(AClass) === AMiddle);
function BBase(n) { this.n = n; }
BBase.prototype.who = function () { return "base"; };
BBase.prototype.size = function () { return this.n; };
BBase.prototype.both = function () { return this.who() + this.size(); };
BBase.fixed = function () { return "fixed"; };
function BMiddle(n) { BBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(BMiddle.prototype, BBase.prototype);
BMiddle.prototype.mid = function () { return "mid" + this.m; };
function BLeaf(n) { BMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(BLeaf.prototype, BMiddle.prototype);
BLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class BClass extends BMiddle { own() { return "own" + this.m; } }
function Bask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("B " + label + ": " + answers);
}
var Bobjects = [new BLeaf(1), new BClass(2)];
Bask("from below", Bobjects);
unseen(BBase).prototype.who = function () { return "replaced"; };
Bask("a method of the base is replaced", Bobjects);
Bobjects.push(new BLeaf(3), new BClass(4));
Bask("more from below", Bobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Bi = 0; Bi < 4; Bi++) { var Bmade = Bi & 1 ? new BBase(10 + Bi) : new BMiddle(10 + Bi); lines.push("B made " + Bmade.who() + Bmade.size() + Bmade.both() + " " + Object.keys(Bmade).join("")); Bobjects.push(Bmade); }
Bask("with their own objects", Bobjects);
Object.defineProperty(unseen(BBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Bask("changed behind their first objects", Bobjects);
lines.push("B " + BBase.fixed() + " " + (Bobjects[0] instanceof BBase) + " " + (Bobjects[5] instanceof BBase) + " " + Object.getPrototypeOf(BClass) === BMiddle);
function CBase(n) { this.n = n; }
CBase.prototype.who = function () { return "base"; };
CBase.prototype.size = function () { return this.n; };
CBase.prototype.both = function () { return this.who() + this.size(); };
CBase.fixed = function () { return "fixed"; };
function CMiddle(n) { CBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(CMiddle.prototype, CBase.prototype);
CMiddle.prototype.mid = function () { return "mid" + this.m; };
function CLeaf(n) { CMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(CLeaf.prototype, CMiddle.prototype);
CLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class CClass extends CMiddle { own() { return "own" + this.m; } }
function Cask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("C " + label + ": " + answers);
}
var Cobjects = [new CLeaf(1), new CClass(2)];
Cask("from below", Cobjects);
delete unseen(CBase).prototype.who; Object.setPrototypeOf(unseen(CBase).prototype, { who: function () { return "above"; } });
Cask("a method of the base is deleted and found above", Cobjects);
Cobjects.push(new CLeaf(3), new CClass(4));
Cask("more from below", Cobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Ci = 0; Ci < 4; Ci++) { var Cmade = Ci & 1 ? new CBase(10 + Ci) : new CMiddle(10 + Ci); lines.push("C made " + Cmade.who() + Cmade.size() + Cmade.both() + " " + Object.keys(Cmade).join("")); Cobjects.push(Cmade); }
Cask("with their own objects", Cobjects);
Object.defineProperty(unseen(CBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Cask("changed behind their first objects", Cobjects);
lines.push("C " + CBase.fixed() + " " + (Cobjects[0] instanceof CBase) + " " + (Cobjects[5] instanceof CBase) + " " + Object.getPrototypeOf(CClass) === CMiddle);
function DBase(n) { this.n = n; }
DBase.prototype.who = function () { return "base"; };
DBase.prototype.size = function () { return this.n; };
DBase.prototype.both = function () { return this.who() + this.size(); };
DBase.fixed = function () { return "fixed"; };
function DMiddle(n) { DBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(DMiddle.prototype, DBase.prototype);
DMiddle.prototype.mid = function () { return "mid" + this.m; };
function DLeaf(n) { DMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(DLeaf.prototype, DMiddle.prototype);
DLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class DClass extends DMiddle { own() { return "own" + this.m; } }
function Dask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("D " + label + ": " + answers);
}
var Dobjects = [new DLeaf(1), new DClass(2)];
Dask("from below", Dobjects);
unseen(DMiddle).prototype.who = function () { return "hidden"; };
Dask("the one in the middle hides a method", Dobjects);
Dobjects.push(new DLeaf(3), new DClass(4));
Dask("more from below", Dobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Di = 0; Di < 4; Di++) { var Dmade = Di & 1 ? new DBase(10 + Di) : new DMiddle(10 + Di); lines.push("D made " + Dmade.who() + Dmade.size() + Dmade.both() + " " + Object.keys(Dmade).join("")); Dobjects.push(Dmade); }
Dask("with their own objects", Dobjects);
Object.defineProperty(unseen(DBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Dask("changed behind their first objects", Dobjects);
lines.push("D " + DBase.fixed() + " " + (Dobjects[0] instanceof DBase) + " " + (Dobjects[5] instanceof DBase) + " " + Object.getPrototypeOf(DClass) === DMiddle);
function EBase(n) { this.n = n; }
EBase.prototype.who = function () { return "base"; };
EBase.prototype.size = function () { return this.n; };
EBase.prototype.both = function () { return this.who() + this.size(); };
EBase.fixed = function () { return "fixed"; };
function EMiddle(n) { EBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(EMiddle.prototype, EBase.prototype);
EMiddle.prototype.mid = function () { return "mid" + this.m; };
function ELeaf(n) { EMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(ELeaf.prototype, EMiddle.prototype);
ELeaf.prototype.leaf = function () { return "leaf" + this.l; };
class EClass extends EMiddle { own() { return "own" + this.m; } }
function Eask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("E " + label + ": " + answers);
}
var Eobjects = [new ELeaf(1), new EClass(2)];
Eask("from below", Eobjects);
Object.setPrototypeOf(unseen(EMiddle).prototype, { who: function () { return "moved"; }, size: function () { return -1; }, both: function () { return "both"; } });
Eask("the link of the one in the middle moves", Eobjects);
Eobjects.push(new ELeaf(3), new EClass(4));
Eask("more from below", Eobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Ei = 0; Ei < 4; Ei++) { var Emade = Ei & 1 ? new EBase(10 + Ei) : new EMiddle(10 + Ei); lines.push("E made " + Emade.who() + Emade.size() + Emade.both() + " " + Object.keys(Emade).join("")); Eobjects.push(Emade); }
Eask("with their own objects", Eobjects);
Object.defineProperty(unseen(EBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Eask("changed behind their first objects", Eobjects);
lines.push("E " + EBase.fixed() + " " + (Eobjects[0] instanceof EBase) + " " + (Eobjects[5] instanceof EBase) + " " + Object.getPrototypeOf(EClass) === EMiddle);
function FBase(n) { this.n = n; }
FBase.prototype.who = function () { return "base"; };
FBase.prototype.size = function () { return this.n; };
FBase.prototype.both = function () { return this.who() + this.size(); };
FBase.fixed = function () { return "fixed"; };
function FMiddle(n) { FBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(FMiddle.prototype, FBase.prototype);
FMiddle.prototype.mid = function () { return "mid" + this.m; };
function FLeaf(n) { FMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(FLeaf.prototype, FMiddle.prototype);
FLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class FClass extends FMiddle { own() { return "own" + this.m; } }
function Fask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("F " + label + ": " + answers);
}
var Fobjects = [new FLeaf(1), new FClass(2)];
Fask("from below", Fobjects);
unseen(FBase).prototype = { who: function () { return "other object"; }, size: function () { return -2; }, both: function () { return "other both"; } };
Fask("the base gets another prototype object", Fobjects);
Fobjects.push(new FLeaf(3), new FClass(4));
Fask("more from below", Fobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Fi = 0; Fi < 4; Fi++) { var Fmade = Fi & 1 ? new FBase(10 + Fi) : new FMiddle(10 + Fi); lines.push("F made " + Fmade.who() + Fmade.size() + Fmade.both() + " " + Object.keys(Fmade).join("")); Fobjects.push(Fmade); }
Fask("with their own objects", Fobjects);
Object.defineProperty(unseen(FBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Fask("changed behind their first objects", Fobjects);
lines.push("F " + FBase.fixed() + " " + (Fobjects[0] instanceof FBase) + " " + (Fobjects[5] instanceof FBase) + " " + Object.getPrototypeOf(FClass) === FMiddle);
function GBase(n) { this.n = n; }
GBase.prototype.who = function () { return "base"; };
GBase.prototype.size = function () { return this.n; };
GBase.prototype.both = function () { return this.who() + this.size(); };
GBase.fixed = function () { return "fixed"; };
function GMiddle(n) { GBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(GMiddle.prototype, GBase.prototype);
GMiddle.prototype.mid = function () { return "mid" + this.m; };
function GLeaf(n) { GMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(GLeaf.prototype, GMiddle.prototype);
GLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class GClass extends GMiddle { own() { return "own" + this.m; } }
function Gask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("G " + label + ": " + answers);
}
var Gobjects = [new GLeaf(1), new GClass(2)];
Gask("from below", Gobjects);
Object.defineProperty(unseen(GBase).prototype, unseen("n"), { set: function (value) { lines.push("G set " + value); }, get: function () { return "got"; }, configurable: true });
Gask("a setter for a field gets onto the base", Gobjects);
Gobjects.push(new GLeaf(3), new GClass(4));
Gask("more from below", Gobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Gi = 0; Gi < 4; Gi++) { var Gmade = Gi & 1 ? new GBase(10 + Gi) : new GMiddle(10 + Gi); lines.push("G made " + Gmade.who() + Gmade.size() + Gmade.both() + " " + Object.keys(Gmade).join("")); Gobjects.push(Gmade); }
Gask("with their own objects", Gobjects);
Object.defineProperty(unseen(GBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Gask("changed behind their first objects", Gobjects);
lines.push("G " + GBase.fixed() + " " + (Gobjects[0] instanceof GBase) + " " + (Gobjects[5] instanceof GBase) + " " + Object.getPrototypeOf(GClass) === GMiddle);
function HBase(n) { this.n = n; }
HBase.prototype.who = function () { return "base"; };
HBase.prototype.size = function () { return this.n; };
HBase.prototype.both = function () { return this.who() + this.size(); };
HBase.fixed = function () { return "fixed"; };
function HMiddle(n) { HBase.call(this, n); this.m = n + 1; }
Object.setPrototypeOf(HMiddle.prototype, HBase.prototype);
HMiddle.prototype.mid = function () { return "mid" + this.m; };
function HLeaf(n) { HMiddle.call(this, n); this.l = n + 2; }
Object.setPrototypeOf(HLeaf.prototype, HMiddle.prototype);
HLeaf.prototype.leaf = function () { return "leaf" + this.l; };
class HClass extends HMiddle { own() { return "own" + this.m; } }
function Hask(label, objects) {
  var answers = "";
  for (var round = 0; round < 30; round++) {
    answers = "";
    for (var index = 0; index < objects.length; index++) {
      var one = objects[index];
      answers += one.who() + "," + one.size() + "," + one.both() + "," + (one.mid ? one.mid() : "-") + "," + (one.leaf ? one.leaf() : "-") + "," + (one.own ? one.own() : "-") + " ";
    }
  }
  lines.push("H " + label + ": " + answers);
}
var Hobjects = [new HLeaf(1), new HClass(2)];
Hask("from below", Hobjects);
Object.defineProperty(unseen(HBase).prototype, "size", { get: function () { return function () { return "by getter"; }; }, configurable: true });
Hask("a method becomes a getter", Hobjects);
Hobjects.push(new HLeaf(3), new HClass(4));
Hask("more from below", Hobjects);
// The first objects of the two above are made in a loop that asks them at once.
for (var Hi = 0; Hi < 4; Hi++) { var Hmade = Hi & 1 ? new HBase(10 + Hi) : new HMiddle(10 + Hi); lines.push("H made " + Hmade.who() + Hmade.size() + Hmade.both() + " " + Object.keys(Hmade).join("")); Hobjects.push(Hmade); }
Hask("with their own objects", Hobjects);
Object.defineProperty(unseen(HBase).prototype, "size", { value: function () { return "late"; }, writable: true, configurable: true });
Hask("changed behind their first objects", Hobjects);
lines.push("H " + HBase.fixed() + " " + (Hobjects[0] instanceof HBase) + " " + (Hobjects[5] instanceof HBase) + " " + Object.getPrototypeOf(HClass) === HMiddle);
console.log(lines.join("\n"));
