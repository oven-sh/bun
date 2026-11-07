// The highest class of a row that lists a name gives the name its form in every class below. One name stands here in five rows at once: how high another row lists it, and under which form, says nothing about this row.
// RUN(FAR): link
// FAR: layout {{*}}kind=Instance name="StoresFarBelow" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(PLAIN): link
// PLAIN: layout {{*}}kind=Instance name="DefinesBelowPlain" {{*}}key="mark"
// PLAIN-NOT: layout {{*}}kind=Instance name="DefinesBelowPlain" {{*}}form=[
// RUN(BOTH): link
// BOTH: layout {{*}}kind=Instance name="StoresBelowBoth" {{*}}key="mark"
// BOTH-NOT: layout {{*}}kind=Instance name="StoresBelowBoth" {{*}}form=[
// RUN(LEFT): link
// LEFT: layout {{*}}kind=Instance name="BelowHiddenBranch" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(RIGHT): link
// RIGHT: layout {{*}}kind=Instance name="BelowPlainBranch" {{*}}key="mark"
// RIGHT-NOT: layout {{*}}kind=Instance name="BelowPlainBranch" {{*}}form=[
// RUN(DEEP): link
// DEEP: layout {{*}}kind=Instance name="DeepThree" {{*}}key="mark" {{*}}form=[IsNotEnumerable]
// RUN(ALONE): link
// ALONE: layout {{*}}kind=Instance name="LowAlone" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotConfigurable]

class HiddenTop {
  constructor() {
    Object.defineProperty(this, "mark", { value: 1, writable: true });
  }
}
class Between extends HiddenTop {
  constructor() {
    super();
    this.between = 2;
  }
}
class BetweenAgain extends Between {
  constructor() {
    super();
    this.again = 3;
  }
}
class StoresFarBelow extends BetweenAgain {
  constructor() {
    super();
    this.mark = 4;
  }
}
class PlainTop {
  constructor() {
    this.mark = 1;
  }
}
class DefinesBelowPlain extends PlainTop {
  constructor() {
    super();
    Object.defineProperty(this, "mark", { value: 2, writable: true });
  }
}
class StoresBelowBoth extends DefinesBelowPlain {
  constructor() {
    super();
    this.mark = 3;
  }
}
class SharedTop {
  constructor() {
    this.first = 0;
  }
}
class HiddenBranch extends SharedTop {
  constructor() {
    super();
    Object.defineProperty(this, "mark", { value: 1, writable: true });
  }
}
class PlainBranch extends SharedTop {
  constructor() {
    super();
    this.mark = 2;
  }
}
class BelowHiddenBranch extends HiddenBranch {
  constructor() {
    super();
    this.mark = 3;
  }
}
class BelowPlainBranch extends PlainBranch {
  constructor() {
    super();
    Object.defineProperty(this, "mark", { value: 4, writable: true });
  }
}
class DeepZero {
  constructor() {
    this.zero = 0;
  }
}
class DeepOne extends DeepZero {
  constructor() {
    super();
    this.one = 1;
  }
}
class DeepTwo extends DeepOne {
  constructor() {
    super();
    Object.defineProperty(this, "mark", { value: 2, writable: true, configurable: true });
  }
}
class DeepThree extends DeepTwo {
  constructor() {
    super();
    this.mark = 3;
  }
}
class TopAlone {
  constructor() {
    this.other = 0;
  }
}
class LowAlone extends TopAlone {
  constructor() {
    super();
    Object.defineProperty(this, "mark", { value: 5, enumerable: true });
  }
}
globalThis.keep = [
  new HiddenTop(),
  new Between(),
  new BetweenAgain(),
  new StoresFarBelow(),
  new PlainTop(),
  new DefinesBelowPlain(),
  new StoresBelowBoth(),
  new SharedTop(),
  new HiddenBranch(),
  new PlainBranch(),
  new BelowHiddenBranch(),
  new BelowPlainBranch(),
  new DeepZero(),
  new DeepOne(),
  new DeepTwo(),
  new DeepThree(),
  new TopAlone(),
  new LowAlone(),
];
console.log(globalThis.keep.map(row => row.constructor.name + ":" + Object.keys(row).join() + ":" + row.mark).join(" "));
