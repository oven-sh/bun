// The constructor stores one field, calls a function it was given, and stores a second field into the object it is still building.
// The function puts a setter for the second field on the prototype. Later constructions meet setters for both. Class fields define and never call a setter.
const log: string[] = [];
function setter(holder: object, name: string) {
  Object.defineProperty(holder, name, {
    set(this: object, value: unknown) {
      log.push(`${name} = ${value} with [${Object.keys(this)}]`);
    },
    configurable: true,
  });
}
class Built {
  declare first?: number;
  declare second?: number;
  constructor(between?: () => void) {
    this.first = 1;
    between?.();
    this.second = 2;
  }
}
class WithFields {
  first = 1;
  second?: number = 2;
  third?: number;
}
class Base {
  declare tag?: string;
  constructor(between?: (target: Function) => void) {
    between?.(new.target);
    this.tag = "base";
  }
}
class Derived extends Base {
  declare more?: string;
  constructor(between?: (target: Function) => void) {
    super(between);
    this.more = "derived";
  }
}
function flush() {
  const text = log.join(", ");
  log.length = 0;
  return text;
}
function keys(object: object) {
  return `[${Object.keys(object)}]`;
}

let count = 0;
for (let i = 0; i < 3000; i++) count += Object.keys(new Built()).length + Object.keys(new WithFields()).length + Object.keys(new Derived()).length;
console.log("warm", count);

const name = (text: string) => text.split("").reverse().reverse().join("");
console.log("in the middle:", keys(new Built(() => setter(Built.prototype, name("second")))), "|", flush());
console.log("the next one:", keys(new Built()), "|", flush());
setter(Built.prototype, name("first"));
console.log("both:", keys(new Built()), "|", flush());
delete (Built.prototype as any).first;
delete (Built.prototype as any).second;
console.log("gone again:", keys(new Built()), "|", flush());

setter(WithFields.prototype, name("first"));
setter(WithFields.prototype, name("second"));
setter(WithFields.prototype, name("third"));
const fields = new WithFields();
console.log("class fields:", keys(fields), fields.first, fields.second, fields.third, "|", flush());
fields.third = 3;
console.log("a store to a field that holds undefined:", keys(fields), fields.third, "|", flush());

console.log(
  "through new.target:",
  keys(
    new Derived(target => {
      setter(target.prototype, name("tag"));
      setter(target.prototype, name("more"));
    }),
  ),
  "|",
  flush(),
);
console.log("the base alone:", keys(new Base()), "|", flush());
console.log("the next one:", keys(new Derived()), "|", flush());
