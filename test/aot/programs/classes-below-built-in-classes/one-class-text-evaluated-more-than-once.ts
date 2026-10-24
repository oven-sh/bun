// The text of a class below a built-in class is evaluated more than once: each evaluation gives a class with a prototype object, captured values and static members of its own.
const lines: string[] = [];
function tagged(tag: string, step: number) {
  return class Tagged extends Map<string, number> {
    count = step;
    static made = 0;
    constructor() {
      super([[tag, step]]);
      Tagged.made++;
    }
    tag(): string {
      return tag + this.count + ":" + this.get(tag) + ":" + this.size;
    }
    bump(): number {
      this.count += step;
      return this.count;
    }
  };
}
const First = tagged("first", 1);
const Second = tagged("second", 10);
type Tagged = InstanceType<typeof First>;
function use(k: Tagged): string {
  return k.tag() + " " + k.bump() + " " + (k instanceof First) + (k instanceof Second) + (k instanceof Map) + " " + (Object.getPrototypeOf(k) === First.prototype);
}
function failing<T extends new (...operands: any[]) => Error>(Parent: T, code: number) {
  return class Coded extends Parent {
    code = code;
    describe(): string {
      return this.name + ":" + this.message + ":" + this.code;
    }
  };
}
const Plain = failing(Error, 1);
const Typed = failing(TypeError, 2);
const Twice = failing(Plain, 3);
function describe(k: InstanceType<typeof Plain>): string {
  return k.describe() + " " + (k instanceof Plain) + (k instanceof Typed) + (k instanceof Twice) + (k instanceof TypeError);
}
for (let round = 0; round < 4; round++) {
  const list: Tagged[] = [new First(), new Second(), new First(), new (tagged("third", 100))()];
  for (const each of list) lines.push(use(each));
  for (const each of [new Plain("p"), new Typed("t"), new Twice("w")]) lines.push(describe(each as InstanceType<typeof Plain>));
  if (round === 1) (First.prototype as any).tag = function () { return "replaced on the first"; };
  if (round === 2) Object.setPrototypeOf(Second.prototype, First.prototype);
  Bun.gc(true);
}
lines.push(First.made + " " + Second.made);
console.log(lines.join("\n"));
