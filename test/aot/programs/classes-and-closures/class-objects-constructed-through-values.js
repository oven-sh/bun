const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());

function constructOne(constructor, value) {
  return new constructor(value);
}

function callOne(callee, value) {
  return callee(value);
}

class Base {
  constructor(x) {
    this.x = x;
  }
  describe() {
    return "base " + this.x;
  }
}

class WithStatics {
  static made = 0;
  static make(x) {
    return new this(x);
  }
  constructor(x) {
    this.x = x;
    WithStatics.made++;
  }
}

class Derived extends Base {
  constructor(x) {
    super(x + 1);
    this.y = x;
  }
}

class DerivedTwice extends Derived {
  describe() {
    return "twice " + super.describe() + " " + this.y;
  }
}

function mixin(Parent, tag) {
  return class extends Parent {
    constructor(x) {
      super(x);
      this.tag = tag;
    }
  };
}

function makeClass(tag) {
  return class {
    constructor(x) {
      this.x = x;
      this.tag = tag;
    }
  };
}

function OldStyle(x) {
  this.x = x;
}
OldStyle.prototype.describe = function () {
  return "old " + this.x;
};
OldStyle.extra = 1;

class OverOldStyle extends OldStyle {}
class OverMap extends Map {}
class OverArray extends Array {}

const lines = [];
for (let round = 0; round < 4; ++round) {
  lines.push(constructOne(Base, round).describe(), constructOne(WithStatics, round).x, WithStatics.make(round).x, WithStatics.made);
  lines.push(constructOne(Derived, round).describe(), constructOne(Derived, round).y, constructOne(DerivedTwice, round).describe());
  const Mixed = mixin(round % 2 ? Base : Derived, "m" + round);
  lines.push(constructOne(Mixed, round).describe(), constructOne(Mixed, round).tag, constructOne(mixin(Mixed, "again"), round).tag);
  lines.push(constructOne(makeClass(round), round).tag, constructOne(OldStyle, round).describe(), constructOne(OverOldStyle, round).describe());
  lines.push(constructOne(OverMap, [[round, round]]).get(round), constructOne(OverArray, 3).length, constructOne(OverArray, 3) instanceof OverArray);
  if (round === 1) Base.added = round;
  if (round === 2) Object.setPrototypeOf(Derived, OldStyle);
  collect(round % 2 === 0);
}
for (const callee of [Base, Derived, makeClass(1)]) {
  try {
    callOne(callee, 1);
    lines.push("called");
  } catch (error) {
    lines.push(error instanceof TypeError);
  }
}

let constructed = 0;
let refused = 0;
for (let round = 0; round < 6; ++round) {
  for (let i = 0; i < 200; ++i) {
    const Made = mixin(makeClass(i), i);
    Made["static" + i] = i;
    constructed += constructOne(Made, 1).x;
  }
  collect(true);
  for (let i = 0; i < 400; ++i) {
    const plain = { ["key" + round + "x" + i]: i };
    try {
      constructOne(plain, 1);
      lines.push("constructed a plain object");
    } catch (error) {
      refused += error instanceof TypeError ? 1 : 0;
    }
  }
}
lines.push(constructed, refused);
console.log(lines.join("\n"));
