class Counter {
  #map = new Map<string, number>();
  #step: number;
  #read = () => this.#step;
  static #made = 0;
  label = `counter ${++Counter.#made}`;
  constructor(step: number) {
    this.#step = step;
  }
  #bump(name: string) {
    const next = (this.#map.get(name) ?? 0) + this.#read();
    this.#map.set(name, next);
    return next;
  }
  add(name: string) {
    return this.#bump(name);
  }
  static is(it: object) {
    return #map in it && #step in it && #bump in it;
  }
}
class Heir extends Counter {
  #own = [1];
  extra: string;
  constructor(step: number, extra: string) {
    super(step);
    this.extra = extra;
    this.#own.push(step);
  }
  own() {
    return this.#own.join();
  }
}
for (let i = 1; i < 4; i++) {
  const counter = new Counter(i), heir = new Heir(i + 0.5, "e" + i);
  console.log(counter.add("a"), counter.add("a"), heir.add("a"), heir.add("b"), heir.own(), counter.label, heir.label, heir.extra);
  console.log(Counter.is(counter), Counter.is(heir), Counter.is({}), JSON.stringify(heir), Object.keys(heir).join());
}
class Returning {
  x = { deep: [1] };
  y: number;
  constructor(y: number) {
    this.y = y;
    if (y === 2) return { x: { deep: [] }, y: -1 } as any;
  }
}
console.log(JSON.stringify([1, 2, 3].map(it => new Returning(it))));
function Target() {}
Target.prototype = { tag: "target" };
const reflected: any = Reflect.construct(Counter as any, [5], Target as any);
console.log(reflected.tag, Counter.is(reflected), reflected.label, Object.getPrototypeOf(reflected) === Target.prototype);
class Accessors {
  accessor a = new Set([1]);
  b: number;
  accessor c: number;
  d = new Date(0).getTime();
  constructor(b: number, c: number) {
    this.b = b;
    this.c = c;
  }
}
const accessors = new Accessors(1, 2);
console.log(accessors.a.size, accessors.b, accessors.c, accessors.d, Object.keys(accessors).join());
class Keys {
  "quoted name" = [1].length;
  7 = new Map().size;
  __proto__ = { p: 1 };
  constructor(public value: string) {}
}
const keys: any = new Keys("v");
console.log(Object.keys(keys).join(), keys.p, Object.getOwnPropertyDescriptor(keys, "__proto__")?.value.p, keys["quoted name"], keys[7], Object.getPrototypeOf(keys) === Keys.prototype);
class Trapped {
  trapped = [5][0];
  other: number;
  constructor(other: number) {
    this.other = other;
  }
}
Object.defineProperty(Trapped.prototype, "trapped", { set() { console.log("no setter runs"); }, configurable: true });
Object.defineProperty(Trapped.prototype, "other", { get() { return "no getter runs"; }, configurable: true });
console.log(JSON.stringify(new Trapped(6)));
class Frozen {
  x = Object.freeze([1]);
  y: number;
  constructor(y: number) {
    this.y = y;
    Object.freeze(this);
  }
}
const frozen: any = new Frozen(3);
try {
  frozen.y = 4;
} catch (error: any) {
  console.log(error.name, frozen.y, frozen.x.length);
}
const undefineds = new (class {
  a: any;
  b = new Array(2);
  c: any;
  constructor(c: any) {
    this.c = c;
  }
})(undefined);
console.log("a" in undefineds, undefineds.a, undefineds.c, undefineds.b.length, Object.keys(undefineds).join());
