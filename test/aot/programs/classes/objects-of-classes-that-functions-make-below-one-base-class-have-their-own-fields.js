// Functions that each make a class below the class they are given. All are given one base class, and a class is declared below what each of them makes.
// An object has the fields of the classes it was made through, in the order in which their constructors store them, and none of a class beside them.
// The same where one function is given two base classes, where new.target is a class that is not below the constructor, and where a class gets another class above it later.
class Base {
  constructor() {
    this.base = 1;
  }
  describe() {
    return Object.keys(this).join() + " " + Object.values(this).join();
  }
}
class Other {
  constructor() {
    this.other = 10;
  }
  describe() {
    return "other " + Object.keys(this).join();
  }
}
function withFirst(Above) {
  return class extends Above {
    constructor() {
      super();
      this.first = 2;
    }
  };
}
function withSecond(Above) {
  return class extends Above {
    constructor() {
      super();
      this.second = 3;
    }
    describe() {
      return "second " + super.describe();
    }
  };
}
function withThird(Above) {
  return class extends Above {
    third = 4;
  };
}
class BelowFirst extends withFirst(Base) {
  constructor() {
    super();
    this.belowFirst = 5;
  }
}
class BelowSecond extends withSecond(Base) {
  constructor() {
    super();
    this.belowSecond = 6;
  }
}
class BelowThird extends withThird(Base) {
  belowThird = 7;
}

function show(object) {
  console.log(object.describe(), "first" in object, object.second, object.third, object.base, object.other);
}
for (const object of [new BelowFirst(), new BelowSecond(), new BelowThird(), new Base()]) show(object);

const Alone = withFirst(Base);
show(new Alone());
console.log(new Alone() instanceof BelowFirst, new BelowFirst() instanceof Alone, new BelowFirst() instanceof Base);

const ThirdOverBase = withThird(Base);
const ThirdOverOther = withThird(Other);
class BelowBoth extends ThirdOverOther {
  belowBoth = 8;
}
show(new ThirdOverBase());
show(new ThirdOverOther());
show(new BelowBoth());

const stacked = new (withFirst(withSecond(withThird(Base))))();
show(stacked);

for (const [constructor, newTarget] of [
  [Base, BelowSecond],
  [Other, BelowFirst],
  [Other, BelowThird],
  [BelowFirst, BelowSecond],
  [Base, Other],
  [BelowBoth, BelowFirst],
]) {
  const made = Reflect.construct(constructor, [], newTarget);
  console.log(Object.keys(made).join(), made instanceof newTarget, made instanceof constructor, Object.getPrototypeOf(made) === newTarget.prototype);
  made.first = "stored";
  made.belowSecond = "stored";
  console.log(Object.keys(made).join(), made.describe());
}

Object.setPrototypeOf(BelowThird, Other);
const moved = new BelowThird();
console.log(Object.keys(moved).join(), moved instanceof Base, moved instanceof Other, moved.describe());
