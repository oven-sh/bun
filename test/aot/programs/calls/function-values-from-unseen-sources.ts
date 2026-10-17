// Where the compiler expects one function at a call because it saw only that one get there, every other callable that arrives at run time is still called as in plain Bun.
type Visit = (this: unknown, a?: number, b?: number, ...rest: number[]) => unknown;
const log: string[] = [];
function run(visit: Visit, label: string) {
  for (let i = 0; i < 3; i++) {
    try { log.push(label + ":" + String(visit(i)) + "," + String(visit(i, 2)) + "," + String(visit()) + "," + String(visit(i, 2, 3, 4, 5, 6, 7, 8, 9))); } catch (e) { log.push(label + "!" + (e as Error).constructor.name); }
  }
}
class Holder {
  visit: Visit;
  constructor(visit: Visit) { this.visit = visit; }
  go(label: string) { for (let i = 0; i < 3; i++) log.push(label + ":" + String(this.visit(i, i + 1))); }
}
const expected: Visit = function (a = 10, b = 20) { return typeof this + a + "/" + b; };
run(expected, "expected");
const holder = new Holder(expected);
holder.go("field");

const hidden: any = {};
function smuggle<T>(value: T): T { hidden.value = value; return JSON.parse("[1]").length ? hidden.value : value; }
const others: Record<string, unknown> = {
  arrow: (a = 1, b = 2) => a * b,
  rest: (...all: number[]) => all.length + "[" + all.join() + "]",
  usesArguments: function () { return arguments.length; },
  usesThis: function (this: unknown, a?: number) { return (this === undefined ? "none" : typeof this) + a; },
  bound: expected.bind({ bound: true }, 7),
  boundTwice: expected.bind(null).bind({}, 1, 2),
  proxy: new Proxy(expected, { apply(target, self, list) { return "trap" + list.length + Reflect.apply(target, self, list); } }),
  native: Math.max,
  constructorOfNumbers: Number,
  async: async (a?: number) => a,
  generator: function* (a?: number) { yield a; },
  classObject: class { constructor() {} },
  sameTextOtherClosure: (() => { const copy: Visit = function (a = 10, b = 20) { return typeof this + a + "/" + b; }; return copy; })(),
};
const notCallable: Record<string, unknown> = { nothing: undefined, none: null, number: 5, text: "f", object: {}, list: [expected] };
function runAnything(visit: any, label: string) {
  for (let i = 0; i < 3; i++) {
    try { log.push(label + ":" + String(visit(i)) + "," + String(visit(i, 2))); } catch (e) { log.push(label + "!" + (e as Error).constructor.name); }
  }
}
runAnything(expected, "anything");
for (const name of Object.keys(notCallable)) runAnything(smuggle(notCallable[name]), name);
for (const name of Object.keys(others)) runAnything(smuggle(others[name]), name);
for (const name of Object.keys(others)) {
  const value = smuggle(others[name]) as Visit;
  run(value, name);
  (holder as any).visit = value;
  try { holder.go(name); } catch (e) { log.push(name + "!" + (e as Error).constructor.name); }
}

const decorated = smuggle(expected) as Visit & { extra?: number };
decorated.extra = 1;
Object.defineProperty(decorated, "name", { value: "renamed" });
run(decorated, "decorated " + decorated.name + decorated.length + decorated.extra);
Object.setPrototypeOf(decorated, { call() { return "own call"; } });
run(decorated, "another prototype");
console.log(decorated === expected, holder.visit === others.sameTextOtherClosure);

const withGetter = { count: 0, get visit(): Visit { this.count++; return this.count % 2 ? expected : (others.arrow as Visit); } };
for (let i = 0; i < 4; i++) log.push("getter:" + String(withGetter.visit(i, 3)));
function pick(flag: boolean): Visit { return flag ? expected : smuggle(others.rest as Visit); }
for (let i = 0; i < 4; i++) log.push("returned:" + String(pick(i % 2 === 0)(i)));
console.log(log.map(line => line.replace(/\[object (Promise|Generator)\]/g, "$1")).join("\n"));
