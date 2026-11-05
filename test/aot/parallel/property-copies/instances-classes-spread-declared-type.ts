// Instances of classes are spread under an interface, over and over, by functions that a table hands out. Their numbers and booleans are there from the constructor on.
// Now and then other code has stored undefined, null or a value of another kind in such a field, removed it, redefined it, added a name, or frozen the instance.
interface Point {
  a: number;
  b: number;
  c: string;
  d: number;
  on: boolean;
}
interface Labeled extends Point {
  label: number;
}
class Holder {
  a = 1;
  b = 2;
  c = "three";
  d = 4;
  on = true;
}
class Measured {
  on: boolean;
  d: number;
  c: string;
  b: number;
  a: number;
  constructor(seed: number) {
    this.on = (seed & 1) === 1;
    this.d = seed * 0.5;
    this.c = "c" + seed;
    this.b = seed;
    this.a = -seed;
  }
}
class Below extends Holder {
  extra = 9;
  get twice() {
    return this.a * 2;
  }
}

const copies: Record<string, (source: any, i: number) => object> = {
  alone: (source): Point => {
    const point: Point = source;
    return { ...point };
  },
  behind: (source, i): Labeled => {
    const point: Point = source;
    return { label: i, ...point };
  },
  inFront: (source, i): Labeled => {
    const point: Point = source;
    return { ...point, label: i };
  },
  rest: source => {
    const point: Point = source;
    const { b, ...others } = point;
    return others;
  },
  untyped: source => ({ ...source }),
};

function show(value: object): string {
  return JSON.stringify(
    Reflect.ownKeys(value).map(key => {
      const held = (value as any)[key];
      return [String(key), Object.is(held, -0) ? "-0" : held === undefined ? "undefined" : typeof held === "number" ? String(held) : held];
    }),
  );
}

const changes: Record<string, (instance: any, i: number) => void> = {
  nothing: () => {},
  undefinedInANumber: instance => void (instance.a = undefined),
  nullInANumber: instance => void (instance.d = null),
  undefinedInABoolean: instance => void (instance.on = undefined),
  nullInABoolean: instance => void (instance.on = null),
  textInANumber: instance => void (instance.b = "text"),
  numberInABoolean: instance => void (instance.on = 7),
  fraction: instance => void (instance.a = 0.25),
  negativeZero: instance => void (instance.b = -0),
  notANumber: instance => void (instance.d = NaN),
  large: instance => void (instance.a = 2 ** 31),
  larger: instance => void (instance.b = 2 ** 53),
  small: instance => void (instance.d = -(2 ** 31)),
  nearlySmall: instance => void (instance.d = -(2 ** 31) + 3),
  removed: instance => void delete instance.b,
  removedAndBack: instance => {
    delete instance.a;
    instance.a = 11;
  },
  hidden: instance => void Object.defineProperty(instance, "d", { enumerable: false }),
  getter: instance => void Object.defineProperty(instance, "a", { get: () => 42, enumerable: true, configurable: true }),
  added: (instance, i) => void (instance.late = i),
  symbol: instance => void (instance[Symbol.for("mark")] = 1),
  element: instance => void (instance[0] = "zero"),
  frozen: instance => void Object.freeze(instance),
  sealed: instance => void Object.seal(instance),
  undefinedAndBack: instance => {
    instance.a = undefined;
    instance.a = 5;
  },
};

const makers: Record<string, (i: number) => object> = {
  holder: () => new Holder(),
  measured: i => new Measured(i),
  below: () => new Below(),
};

const kept: object[] = [];
let lines = 0;
for (const maker in makers) {
  for (const copy in copies) {
    // The usual kind comes often enough that what the run time remembers of it is in use when another kind comes between.
    for (const change in changes) {
      let last = "";
      for (let i = 0; i < 12; i++) {
        const usual = copies[copy](makers[maker](i), i);
        kept[i & 7] = usual;
        const instance = makers[maker](i);
        if (i % 4 === 3) changes[change](instance, i);
        const made = copies[copy](instance, i);
        kept[(i + 1) & 7] = made;
        if (i % 4 === 3) last = show(made) + " " + show(usual) + " " + show(instance);
      }
      console.log(maker, copy, change, last);
      lines++;
    }
  }
}
console.log(lines, kept.length);
