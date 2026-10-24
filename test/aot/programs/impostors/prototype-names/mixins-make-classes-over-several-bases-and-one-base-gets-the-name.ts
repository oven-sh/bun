// A mixin is a function that returns `class extends Base`: one class text, evaluated over different bases. The optional field is declared by the mixin's class.
// The name arrives on the prototype of one base, then on the prototype of one of the mixed classes, then on a base that is itself the result of a mixin.
type Constructor<T = {}> = new (...args: any[]) => T;
const log: string[] = [];
function Stamped<B extends Constructor>(Base: B) {
  return class Stamped extends Base {
    declare stamp?: number;
    readStamp() {
      return this.stamp;
    }
    writeStamp(value: number) {
      this.stamp = value;
    }
  };
}
class Plain {
  id = 1;
}
class Fancy {
  id = 2;
}
const StampedPlain = Stamped(Plain);
const StampedFancy = Stamped(Fancy);
const Twice = Stamped(StampedPlain);
const classes = [StampedPlain, StampedFancy, Twice];
function state(object: InstanceType<typeof StampedPlain>) {
  return `${object.readStamp()} ${"stamp" in object} [${Object.keys(object)}]`;
}
function line() {
  return classes.map(C => state(new C())).join(" | ");
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const object = new classes[i % 3]();
  sum += object.readStamp() ?? 1;
  if (i & 1) object.writeStamp(2);
  sum += object.readStamp() ?? 1;
}
console.log("warm", sum);

const old = classes.map(C => new C());
const name = "stamp".normalize();
(Fancy.prototype as any)[name] = 20;
console.log("one base:", line(), "||", old.map(state).join(" | "));
delete (Fancy.prototype as any)[name];
Object.defineProperty(StampedPlain.prototype, name, {
  get() {
    return 30;
  },
  set(this: { id: number }, value: number) {
    log.push(`stamp = ${value}`);
  },
  configurable: true,
});
console.log("a mixed class that is also a base:", line(), "||", old.map(state).join(" | "));
for (const object of old) object.writeStamp(5);
console.log("stored:", old.map(state).join(" | "), "|", log.join(", "));
delete (StampedPlain.prototype as any)[name];
(Plain.prototype as any)[name] = 40;
const Late = Stamped(Plain);
console.log("the lowest base, and a class mixed afterwards:", line(), "|", state(new Late()));
delete (Plain.prototype as any)[name];
console.log("gone again:", line(), "|", state(new Late()), "||", old.map(state).join(" | "));
