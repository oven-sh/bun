// super(..) in a class that is evaluated with several parents: each parent gets the arguments, the new.target and the object that it gets under plain Bun.
interface Animal {
  name: string;
  describe(): string;
}
type AnimalClass = new (name: string) => Animal;

class Cat {
  name: string;
  legs = 4;
  constructor(name: string) {
    this.name = name;
  }
  describe() {
    return `cat ${this.name} ${this.legs}`;
  }
}

class Bird {
  wings = 2;
  name: string;
  song: string;
  constructor(name: string) {
    this.name = name;
    this.song = name + "!";
  }
  describe() {
    return `bird ${this.name} ${this.wings} ${this.song}`;
  }
}

function Dog(this: { name: string; barks: boolean }, name: string) {
  this.name = name;
  this.barks = true;
}
Dog.prototype.describe = function (this: { name: string; barks: boolean }) {
  return `dog ${this.name} ${this.barks}`;
};

function show(label: string, made: object) {
  console.log(label, JSON.stringify(made), Object.keys(made).join());
}

// Two classes.
const Tagged = (Base: AnimalClass) =>
  class TaggedAnimal extends Base {
    tag: string;
    constructor(name: string, tag: string) {
      super(name);
      this.tag = tag;
    }
    describe() {
      return `${super.describe()} #${this.tag}`;
    }
  };
const TaggedCat = Tagged(Cat);
const TaggedBird = Tagged(Bird);
for (let turn = 0; turn < 3; turn++) {
  const cat = new TaggedCat("tom" + turn, "a");
  const bird = new TaggedBird("tweety" + turn, "b");
  show(cat.describe(), cat);
  show(bird.describe(), bird);
  console.log(cat instanceof Cat, cat instanceof Bird, bird instanceof Cat, bird instanceof Bird);
  console.log(cat instanceof TaggedCat, cat instanceof TaggedBird);
}

// The class itself is among its parents.
let wraps = 0;
const Wrapped = (Base: AnimalClass) =>
  class WrappedAnimal extends Base {
    constructor(name: string) {
      super(name + "'");
      wraps++;
    }
  };
const Once = Wrapped(Cat);
const Twice = Wrapped(Once);
const Thrice = Wrapped(Twice);
console.log(new Once("a").describe(), new Twice("b").describe(), new Thrice("c").describe(), wraps);

// No constructor is written, and one parent is a function that is handed its object.
let made = 0;
const Counted = (Base: AnimalClass) =>
  class CountedAnimal extends Base {
    id = ++made;
  };
for (const Each of [Counted(Cat), Counted(Bird), Counted(Dog as unknown as AnimalClass)]) {
  const animal = new Each("rex");
  show(animal.describe(), animal);
}

// A parent hands back another object, throws, or looks at new.target.
class Impostor {
  name = "never";
  constructor(name: string) {
    return { name: "other " + name, describe: () => "impostor" } as unknown as Impostor;
  }
  describe() {
    return "unused";
  }
}
class Refusing {
  name = "";
  constructor(name: string) {
    throw new RangeError("refuses " + name);
  }
  describe() {
    return "unused";
  }
}
class Watching {
  name: string;
  constructor(name: string) {
    this.name = `${name} for ${new.target.name}`;
  }
  describe() {
    return "watching " + this.name;
  }
}
const Marked = (Base: AnimalClass) =>
  class MarkedAnimal extends Base {
    #mark = "m";
    static isMarked(value: object) {
      return #mark in value;
    }
    constructor(name: string) {
      super(name);
      this.name += "+";
    }
  };
for (const Parent of [Impostor, Refusing, Watching]) {
  const Each = Marked(Parent);
  try {
    const animal = new Each("x");
    console.log(animal.describe(), animal.name, animal instanceof Each, Each.isMarked(animal));
  } catch (error) {
    console.log(String(error));
  }
}

// A parent calls a method of the class below it while the fields of that class are not there yet.
interface Peeker {
  first: string;
  peek(): string;
}
class Early {
  first: string;
  constructor() {
    this.first = this.peek();
  }
  peek() {
    return "early";
  }
}
class Late {
  first: string;
  constructor() {
    this.first = "late, " + this.peek();
  }
  peek() {
    return "late";
  }
}
const Peeking = (Base: new () => Peeker) =>
  class extends Base {
    hidden = "set";
    constructor() {
      super();
    }
    peek() {
      return "hidden is " + this.hidden;
    }
  };
console.log(new (Peeking(Early))().first, new (Peeking(Late))().first);

// Six parents that take a number.
interface Shape {
  area(): number;
}
class Square {
  side: number;
  constructor(size: number) {
    this.side = size;
  }
  area() {
    return this.side * this.side;
  }
}
class Disc {
  radius: number;
  constructor(size: number) {
    this.radius = size / 2;
  }
  area() {
    return 3 * this.radius * this.radius;
  }
}
class Strip {
  length: number;
  constructor(size: number) {
    this.length = size;
  }
  area() {
    return this.length;
  }
}
class Dot {
  constructor(_size: number) {}
  area() {
    return 0;
  }
}
class Hole {
  size: number;
  constructor(size: number) {
    this.size = -size;
  }
  area() {
    return this.size;
  }
}
class Grid {
  cells: number;
  constructor(size: number) {
    this.cells = Math.floor(size) | 0;
  }
  area() {
    return this.cells;
  }
}
const Scaled = (Base: new (size: number) => Shape) =>
  class extends Base {
    factor: number;
    constructor(size: number, factor: number) {
      super(size * factor);
      this.factor = factor;
    }
  };
for (const Each of [Square, Disc, Strip, Dot, Hole, Grid].map(Scaled)) {
  const areas = [2, 0.5, -0, NaN, 2 ** 31].map(size => new Each(size, 3).area());
  console.log(areas.map(area => (Object.is(area, -0) ? "-0" : String(area))).join());
}

// More parents than any site has arms for.
class P0 {
  v = 0;
}
class P1 {
  v = 1;
}
class P2 {
  v = 2;
}
class P3 {
  v = 3;
}
class P4 {
  v = 4;
}
class P5 {
  v = 5;
}
class P6 {
  v = 6;
}
class P7 {
  v = 7;
}
class P8 {
  v = 8;
}
class P9 {
  v = 9;
}
const Plenty = (Base: new () => { v: number }) =>
  class extends Base {
    w = this.v + 1;
  };
console.log([P0, P1, P2, P3, P4, P5, P6, P7, P8, P9].map(Plenty).map(Each => new Each().w).join());

// One parent has a class object for each evaluation, and each has captured something else.
const Offset = (by: number) =>
  class {
    v: number;
    constructor() {
      this.v = by;
    }
  };
const Doubled = (Base: new () => { v: number }) =>
  class extends Base {
    constructor() {
      super();
      this.v *= 2;
    }
  };
console.log([Offset(1), Offset(2), P3].map(Doubled).map(Each => new Each().v).join());

// A list of arguments: one parent takes them all, one has defaults, one counts them.
class Counting {
  count: number;
  constructor(...list: unknown[]) {
    this.count = list.length;
  }
}
class Summing {
  count: number;
  constructor(a = 1, b = 2) {
    this.count = a + b;
  }
}
class Reading {
  count: number;
  constructor() {
    this.count = arguments.length;
  }
}
const Passing = (Base: new (...list: number[]) => { count: number }) =>
  class extends Base {
    constructor(...list: number[]) {
      super(...list);
    }
  };
const listWithHole = [1, , 3] as number[];
for (const Each of [Counting, Summing, Reading].map(Passing)) {
  console.log(new Each().count, new Each(5).count, new Each(5, 6, 7).count, new Each(...listWithHole).count);
}
