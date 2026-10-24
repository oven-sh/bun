// Reflect.set and Reflect.defineProperty put members on the prototypes of two classes, between two reads of the same instance.
// Reflect.set with an instance as the receiver goes the other way: it must fill the instance, or call the setter that is inherited by then.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class First {
  declare id: number;
  mark?: number;
  constructor(id: number) {
    delete this.mark;
    handOver(this);
    this.id = id;
  }
}
class Second {
  declare id: number;
  mark?: number;
  constructor(id: number) {
    delete this.mark;
    handOver(this);
    this.id = id;
  }
}
const log: string[] = [];
function readFirst(object: First) {
  return object.mark;
}
function readSecond(object: Second) {
  return object.mark;
}
function writeSecond(object: Second, value: number) {
  object.mark = value;
}
function aroundSet(object: First, holder: object, name: string) {
  const before = object.mark;
  const answer = Reflect.set(holder, name, 5);
  return `${before} ${answer} ${object.mark}`;
}
function aroundDefine(object: Second, holder: object, name: string) {
  const before = object.mark;
  const answer = Reflect.defineProperty(holder, name, {
    get() {
      return 6;
    },
    set(this: Second, value: number) {
      log.push(`set ${value} on ${this.id}`);
    },
    configurable: true,
  });
  return `${before} ${answer} ${object.mark}`;
}
function describe(object: First | Second) {
  return `${object.mark} ${"mark" in object} ${Object.hasOwn(object, "mark")} [${Object.keys(object)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const first = new First(i);
  const second = new Second(i);
  sum += (readFirst(first) ?? 1) + (readSecond(second) ?? 1);
  if (i & 1) Reflect.set(first, "mark", 2);
  if (i & 2) writeSecond(second, 3);
  sum += (readFirst(first) ?? 1) + (readSecond(second) ?? 1);
}
console.log("warm", sum);

const first = new First(1);
const second = new Second(2);
console.log("Reflect.set:", aroundSet(first, First.prototype, "mark"), "|", describe(first), "|", describe(new First(3)));
console.log("Reflect.defineProperty:", aroundDefine(second, Second.prototype, "mark"), "|", describe(second), "|", describe(new Second(4)));
console.log("receiver:", Reflect.set(First.prototype, "mark", 50, first), describe(first), (First.prototype as any).mark);
console.log("receiver:", Reflect.set(Second.prototype, "mark", 60, second), describe(second), log.join(", "));
console.log("Reflect.get:", Reflect.get(First.prototype, "mark", first), Reflect.get(second, "mark"), Reflect.has(second, "mark"));
console.log("Reflect.deleteProperty:", Reflect.deleteProperty(First.prototype, "mark"), Reflect.deleteProperty(Second.prototype, "mark"));
console.log("gone again:", describe(first), "|", describe(second), "|", describe(new First(5)), "|", describe(new Second(6)));
writeSecond(second, 7);
console.log("stored:", describe(second), log.length);
