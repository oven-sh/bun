interface Shape {
  sides: number;
  label: string;
  area(): number;
}

class Seen implements Shape {
  sides = 4;
  label = "seen";
  area() {
    return this.sides * 10;
  }
}

class ByReflect implements Shape {
  extra = "r";
  label = "by Reflect.construct";
  sides = 5;
  area() {
    return this.sides * 100;
  }
}

class ByComputedName implements Shape {
  label = "by a computed name";
  more = 1;
  other = 2;
  sides = 6;
  area() {
    return this.sides * 1000;
  }
}

class ByBind implements Shape {
  sides = 7;
  padding = 0.5;
  label = "by bind";
  area() {
    return this.sides + this.padding;
  }
}

class ByConstructorProperty implements Shape {
  label = "by the constructor property";
  sides = 8;
  area() {
    return -this.sides;
  }
}

class ByNewTarget implements Shape {
  first = true;
  sides = 9;
  label = "as new.target of another class";
  area() {
    return this.sides * 2;
  }
}

class BySpecies extends Array<number> implements Shape {
  sides = 10;
  label = "by Symbol.species";
  area() {
    return this.sides + this.length;
  }
}

class ByCallback implements Shape {
  sides: number;
  label = "in a callback of a built-in";
  constructor(sides: number) {
    this.sides = sides;
  }
  area() {
    return this.sides * 3;
  }
}

class ByStaticThis implements Shape {
  sides = 12;
  label = "by this in a static method";
  static make(this: new () => Shape): Shape {
    return new this();
  }
  area() {
    return this.sides * 4;
  }
}

function describe(shape: Shape): string {
  return shape.label + ": " + shape.sides + " sides, area " + shape.area() + ", keys " + Object.keys(shape).join();
}

function totalSides(shapes: Shape[]): number {
  let total = 0;
  for (let i = 0; i < shapes.length; i++) total += shapes[i].sides + shapes[i].area();
  return total;
}

const honest: Shape[] = [];
for (let i = 0; i < 2000; i++) honest.push(new Seen());
console.log("2000 honest shapes:", totalSides(honest), describe(honest[0]));

const table: Record<string, new () => Shape> = { ByComputedName };
const key: string = JSON.parse('"ByComputedName"');
const sample = new ByConstructorProperty();
const hidden: Shape[] = [
  Reflect.construct(ByReflect, []),
  new table[key](),
  new (ByBind.bind(null))(),
  new (sample.constructor as new () => Shape)(),
  Reflect.construct(Seen, [], ByNewTarget),
  new BySpecies(1, 2, 3).map(value => value) as BySpecies,
  ...[11].map(sides => new ByCallback(sides)),
  ByStaticThis.make(),
];

for (const shape of hidden) {
  try {
    console.log(describe(shape), "| prototype of", Object.getPrototypeOf(shape).constructor.name);
  } catch (error) {
    console.log("threw", (error as Error).constructor.name);
  }
}
console.log("together:", totalSides(hidden));
console.log("mixed:", totalSides([...honest.slice(0, 3), ...hidden, ...honest.slice(0, 3)]));
console.log("honest again:", totalSides(honest));
