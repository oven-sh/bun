// `super.field` starts its search at the prototype of the base class, past the instance's own slot; `super.field = v` searches there for a setter and otherwise stores into `this`.
// The name arrives on the base's prototype as a value, as accessors and as a read-only value.
const log: string[] = [];
class Base {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
}
class Child extends Base {
  declare level?: number;
  own() {
    return this.level;
  }
  above() {
    return (super.level as number | undefined);
  }
  storeOwn(value: number) {
    this.level = value;
  }
  storeAbove(value: number) {
    super.level = value;
  }
}
interface Base {
  level?: number;
}
function state(child: Child) {
  return `${child.own()} ${child.above()} [${Object.keys(child)}]`;
}
function attempt(run: () => void) {
  try {
    run();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const child = new Child(i);
  sum += (child.own() ?? 1) + (child.above() ?? 1);
  if (i & 1) child.storeOwn(2);
  else child.storeAbove(3);
  sum += (child.own() ?? 1) + (child.above() ?? 1);
}
console.log("warm", sum);

const empty = new Child(1);
const filled = new Child(2);
filled.storeOwn(20);
console.log("before:", state(empty), "|", state(filled));
(Object.getPrototypeOf(Child.prototype) as any)["level"] = 500;
console.log("a value above:", state(empty), "|", state(filled), "|", state(new Child(3)));
empty.storeAbove(10);
console.log("stored through super:", state(empty));
Object.defineProperty(Base.prototype, "level", {
  get(this: Child) {
    return this.id + 600;
  },
  set(this: Child, value: number) {
    log.push(`level = ${value} on ${this.id}`);
  },
  configurable: true,
});
const fresh = new Child(4);
console.log("accessors above:", state(empty), "|", state(filled), "|", state(fresh));
fresh.storeOwn(1);
fresh.storeAbove(2);
filled.storeOwn(21);
filled.storeAbove(22);
console.log("stores:", state(fresh), "|", state(filled), "|", log.join(", "));
Object.defineProperty(Base.prototype, "level", { value: 700, writable: false, configurable: true });
const last = new Child(5);
console.log("read-only above:", attempt(() => last.storeOwn(1)), attempt(() => last.storeAbove(2)), attempt(() => filled.storeOwn(23)), attempt(() => filled.storeAbove(24)), state(last), "|", state(filled));
delete (Base.prototype as any).level;
console.log("gone again:", state(last), attempt(() => last.storeAbove(3)), state(last));
