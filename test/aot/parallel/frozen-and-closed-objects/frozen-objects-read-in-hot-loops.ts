// Frozen configuration objects, frozen tables that stand for enums and frozen instances are read a lot. A read finds what it found before the freeze, and a store among the reads is refused.
const Config = Object.freeze({ width: 3, height: 4, name: "config", nested: Object.freeze({ depth: 5 }) });
const Kind = Object.freeze({ None: 0, First: 1, Second: 2, Third: 4 } as const);
class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }
  plus(other: Vector) {
    return new Vector(this.x + other.x, this.y + other.y);
  }
}
class Open {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function area(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Config.width * Config.height + Config.nested.depth + Config.name.length;
  return sum;
}
function kinds(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (i & Kind.Third ? Kind.Second : Kind.First) + Kind.None;
  return sum;
}
function walk(n: number) {
  let at = new Vector(0, 0);
  const step = new Vector(1, 2);
  for (let i = 0; i < n; i++) at = at.plus(step);
  return at.x * 3 + at.y;
}
function sumOf(list: { x: number; y: number }[], turns: number) {
  let sum = 0;
  for (let t = 0; t < turns; t++) for (let i = 0; i < list.length; i++) sum += list[i].x * 2 + list[i].y;
  return sum;
}
function readAndStore(list: Open[], turns: number) {
  let sum = 0;
  let refused = 0;
  for (let t = 0; t < turns; t++) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      sum += p.x;
      try {
        p.y = p.y + 1;
      } catch {
        refused++;
      }
      sum += p.y;
    }
  }
  return `${sum} ${refused}`;
}
function has(o: object, n: number) {
  let count = 0;
  for (let i = 0; i < n; i++) if ("width" in o && !("missing" in o)) count++;
  return count;
}

console.log(area(20000), kinds(20000), walk(20000));
console.log(sumOf([new Vector(1, 2), new Vector(3, 4), new Open(5, 6), Object.freeze(new Open(7, 8)), Object.freeze({ x: 9, y: 10 })], 4000));
console.log(readAndStore([new Open(1, 2), Object.freeze(new Open(3, 4)), Object.seal(new Open(5, 6)), Object.preventExtensions(new Open(7, 8))], 3000));
console.log(has(Config, 5000), Object.isFrozen(Config), Object.isFrozen(Config.nested), Object.isFrozen(Kind), Object.isFrozen(new Vector(1, 2)), Object.isFrozen(new Open(1, 2)));
console.log(JSON.stringify(Config), Object.keys(Kind).join(), JSON.stringify(Object.getOwnPropertyDescriptor(Config, "width")), JSON.stringify(Object.getOwnPropertyDescriptor(new Vector(1, 2), "y")));
for (const store of [() => ((Config as any).width = 9), () => ((Kind as any).First = 9), () => ((Config as any).added = 9), () => ((Config.nested as any).depth = 9), () => delete (Config as any).width]) {
  try {
    console.log(String(store()));
  } catch (e: any) {
    console.log(e.constructor.name + ": " + e.message);
  }
}
console.log(area(10), kinds(10));
