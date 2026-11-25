// A class gives a name its form in the classes below only where it makes the field in every construction. A store in a method or on an arm, or a value on the prototype, makes nothing at birth: the heir's own definition does, and its form stands. A constructor function runs what is above it where it calls it: what it defines in front of that call it makes itself.
// RUN(METHOD): link
// METHOD: layout {{*}}kind=Instance name="BelowMethod" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(ARM): link
// ARM: layout {{*}}kind=Instance name="BelowArm" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(PROTOTYPE): link
// PROTOTYPE: layout {{*}}kind=Instance name="BelowPrototype" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(MAKER): link
// MAKER: layout {{*}}kind=Instance name="BelowMaker" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(HELPER): link
// HELPER: layout {{*}}kind=Instance name="BelowHelper" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(PLAIN): link
// PLAIN: layout {{*}}kind=Instance name="BelowPlainMaker" {{*}}key="mark"
// PLAIN-NOT: layout {{*}}kind=Instance name="BelowPlainMaker" {{*}}form=[
// RUN(FRONT): link
// FRONT: layout {{*}}kind=Instance name="DefinesInFrontOfCall" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(BEHIND): link
// BEHIND: layout {{*}}kind=Instance name="DefinesBehindCall" {{*}}key="mark"
// BEHIND-NOT: layout {{*}}kind=Instance name="DefinesBehindCall" {{*}}form=[

class StoresInMethod {
  constructor(n) {
    this.size = n;
  }
  clear() {
    this.mark = 0;
  }
}
class BelowMethod extends StoresInMethod {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n });
  }
}
class StoresOnArm {
  constructor(n) {
    this.size = n;
    if (n < 0) this.mark = 0;
  }
}
class BelowArm extends StoresOnArm {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n });
  }
}
class HoldsOnPrototype {
  constructor(n) {
    this.size = n;
  }
}
HoldsOnPrototype.prototype.mark = 0;
class BelowPrototype extends HoldsOnPrototype {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n });
  }
}
class MakerBelowMethod extends StoresInMethod {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n, writable: true });
  }
}
class BelowMaker extends MakerBelowMethod {
  constructor(n) {
    super(n);
    this.mark = n + 1;
  }
}
function tag(row, n) {
  Object.defineProperty(row, "mark", { value: n, writable: true });
}
class MakesByHelper {
  constructor(n) {
    this.size = n;
    tag(this, n);
  }
}
class BelowHelper extends MakesByHelper {
  constructor(n) {
    super(n);
    this.mark = n + 1;
  }
}
class PlainMaker {
  constructor(n) {
    this.mark = n;
  }
}
class DefinesInMethod extends PlainMaker {
  constructor(n) {
    super(n);
    this.size = n;
  }
  hide() {
    Object.defineProperty(this, "mark", { value: 0, enumerable: false });
  }
}
class BelowPlainMaker extends DefinesInMethod {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n + 1, enumerable: false });
  }
}
function PlainFunctionAbove(n) {
  this.mark = n;
}
function DefinesInFrontOfCall(n) {
  Object.defineProperty(this, "mark", { value: n, writable: true });
  PlainFunctionAbove.call(this, n);
}
Object.setPrototypeOf(DefinesInFrontOfCall.prototype, PlainFunctionAbove.prototype);
function DefinesBehindCall(n) {
  PlainFunctionAbove.call(this, n);
  Object.defineProperty(this, "mark", { value: n, writable: true });
}
Object.setPrototypeOf(DefinesBehindCall.prototype, PlainFunctionAbove.prototype);
globalThis.keep = [
  new StoresInMethod(1),
  new BelowMethod(2),
  new StoresOnArm(3),
  new BelowArm(4),
  new HoldsOnPrototype(5),
  new BelowPrototype(6),
  new MakerBelowMethod(7),
  new BelowMaker(8),
  new MakesByHelper(9),
  new BelowHelper(10),
  new PlainMaker(11),
  new DefinesInMethod(12),
  new BelowPlainMaker(13),
  new PlainFunctionAbove(14),
  new DefinesInFrontOfCall(15),
  new DefinesBehindCall(16),
];
globalThis.keep[0].clear();
globalThis.keep[11].hide();
console.log(globalThis.keep.map(row => row.constructor.name + ":" + Object.keys(row).join() + ":" + row.mark).join(" "));
