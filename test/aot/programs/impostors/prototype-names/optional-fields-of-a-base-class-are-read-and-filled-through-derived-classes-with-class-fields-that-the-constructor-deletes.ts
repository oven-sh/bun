// The optional fields are declared by the base class and used through two derived classes and through the base's own type.
// The name arrives below its declaration: on the prototype of one derived class, which lies between its instances and the base. The sibling and the base must not notice. Then it arrives on the base.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
class Base {
  declare id: number;
  cache?: number;
  title?: string;
  constructor(id: number) {
    delete this.cache;
    delete this.title;
    handOver(this);
    this.id = id;
  }
  cached() {
    return (this.cache ??= this.id * 2);
  }
}
class Left extends Base {
  extra?: number;
  constructor(...args: ConstructorParameters<typeof Base>) {
    super(...args);
    delete this.extra;
    handOver(this);
  }
  peek() {
    return this.cache;
  }
}
class Right extends Base {
  extra?: number;
  constructor(...args: ConstructorParameters<typeof Base>) {
    super(...args);
    delete this.extra;
    handOver(this);
  }
  peek() {
    return this.cache;
  }
}
class LeftLeft extends Left {}
function cacheOf(base: Base) {
  return base.cache;
}
function cacheOfLeft(left: Left) {
  return left.cache;
}
function setCache(base: Base, value: number) {
  base.cache = value;
}
function titleOf(right: Right) {
  return right.title ?? "untitled";
}
function state(base: Base) {
  return `${cacheOf(base)} ${base.title} ${"cache" in base} [${Object.keys(base)}]`;
}
function four(id: number): [Base, Left, Right, LeftLeft] {
  return [new Base(id), new Left(id), new Right(id), new LeftLeft(id)];
}
function line(objects: Base[]) {
  return objects.map(state).join(" | ");
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const [base, left, right, deep] = four(i & 7);
  sum += (cacheOf(base) ?? 1) + (cacheOfLeft(left) ?? 1) + (right.peek() ?? 1) + (deep.peek() ?? 1) + titleOf(right).length;
  if (i & 1) sum += base.cached() + left.cached() + right.cached() + deep.cached();
  if (i & 2) setCache(left, 5);
}
console.log("warm", sum);

const old = four(1);
console.log("before:", line(old));
Object.defineProperty(Reflect.getPrototypeOf(old[1])!, "cache", {
  get(this: Left) {
    return undefined;
  },
  set(this: Left, value: number) {
    log.push(`cache = ${value} on a ${this.constructor.name}`);
  },
  configurable: true,
});
console.log("accessors on Left's prototype:", line(old), "||", line(four(2)));
console.log("cached():", old.map(object => object.cached()).join(), "|", log.join(", "));
console.log("after:", line(old));
log.length = 0;
(Base.prototype as any)["title"] = "a title for all";
(Base.prototype as any)["cache"] = 77;
console.log("values on the base's prototype:", line(four(3)), "|", titleOf(new Right(4)), new Left(5).peek(), new Right(5).peek(), new LeftLeft(5).peek());
console.log("cached():", four(6).map(object => object.cached()).join(), "|", log.join(", "));
delete (Left.prototype as any).cache;
console.log("Left's accessors are gone:", line(four(7)));
delete (Base.prototype as any).cache;
delete (Base.prototype as any).title;
console.log("gone again:", line(four(8)), "|", four(9).map(object => object.cached()).join());
