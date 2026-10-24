// `object.field = compute()`: the object is evaluated first, then compute() runs and puts a setter of that name on the prototype, then the store happens.
// The store must call the setter. The same for ??=, ||=, +=, a destructuring target and a store whose value is an argument with a side effect. One class for each form.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
function install(holder: object, name: string, start: number | undefined) {
  Object.defineProperty(holder, name, {
    get() {
      return start;
    },
    set(this: { id: number }, value: number) {
      log.push(`${name} = ${value} on ${this.id}`);
    },
    configurable: true,
  });
}
function classOf(object: object) {
  return Object.getPrototypeOf(object);
}
class Plain {
  declare id: number;
  v?: number;
  constructor(id: number) {
    delete this.v;
    handOver(this);
    this.id = id;
  }
}
class Nullish {
  declare id: number;
  v?: number;
  constructor(id: number) {
    delete this.v;
    handOver(this);
    this.id = id;
  }
}
class Falsy {
  declare id: number;
  v?: number;
  constructor(id: number) {
    delete this.v;
    handOver(this);
    this.id = id;
  }
}
class Pattern {
  declare id: number;
  v?: number;
  constructor(id: number) {
    delete this.v;
    handOver(this);
    this.id = id;
  }
}
class Listed {
  declare id: number;
  v?: number;
  constructor(id: number) {
    delete this.v;
    handOver(this);
    this.id = id;
  }
}
function compute(object: object, arm: boolean) {
  if (arm) install(classOf(object), "v", undefined);
  return 7;
}
function plain(object: Plain, arm: boolean) {
  object.v = compute(object, arm);
  return object;
}
function nullish(object: Nullish, arm: boolean) {
  object.v ??= compute(object, arm);
  return object;
}
function falsy(object: Falsy, arm: boolean) {
  object.v ||= compute(object, arm);
  return object;
}
function pattern(object: Pattern, arm: boolean) {
  ({ a: object.v } = { a: compute(object, arm) });
  return object;
}
function listed(object: Listed, arm: boolean) {
  [object.v] = [compute(object, arm)];
  return object;
}
function state(object: { v?: number }) {
  return `${object.v} [${Object.keys(object)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  sum += plain(new Plain(i), false).v! + nullish(new Nullish(i), false).v! + falsy(new Falsy(i), false).v! + pattern(new Pattern(i), false).v! + listed(new Listed(i), false).v!;
}
console.log("warm", sum);
console.log("=", state(plain(new Plain(1), true)), "| then", state(plain(new Plain(2), false)));
console.log("??=", state(nullish(new Nullish(1), true)), "| then", state(nullish(new Nullish(2), false)));
console.log("||=", state(falsy(new Falsy(1), true)), "| then", state(falsy(new Falsy(2), false)));
console.log("{}", state(pattern(new Pattern(1), true)), "| then", state(pattern(new Pattern(2), false)));
console.log("[]", state(listed(new Listed(1), true)), "| then", state(listed(new Listed(2), false)));
console.log(log.join(", "));
