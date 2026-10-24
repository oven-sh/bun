// `f.call`, `f.apply` and `f.bind` are the built-ins only while nothing hides them: an own property, another prototype, a static method and a proxy take the ordinary lookup, at the same call sites that see unchanged closures.
export {};

type Target = (this: unknown, a: number, b: number) => unknown;

function show(label: string, ...values: unknown[]): void {
  console.log(label + ": " + values.map(value => String(value)).join(" | "));
}

function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function callTyped(f: Target, receiver: unknown): unknown {
  return f.call(receiver, 1, 2);
}
function applyTyped(f: Target, receiver: unknown): unknown {
  return f.apply(receiver, [3, 4]);
}
function bindTyped(f: Target, receiver: unknown): unknown {
  return f.bind(receiver, 5)(6);
}
function callUntyped(f: any, receiver: unknown): unknown {
  return f.call(receiver, 1, 2);
}
function applyUntyped(f: any, receiver: unknown): unknown {
  return f.apply(receiver, [3, 4]);
}
function bindUntyped(f: any, receiver: unknown): unknown {
  return f.bind(receiver, 5)(6);
}

function useAll(label: string, f: any): void {
  show(
    label,
    attempt(() => callTyped(f, "r")),
    attempt(() => applyTyped(f, "r")),
    attempt(() => bindTyped(f, "r")),
    attempt(() => callUntyped(f, "r")),
    attempt(() => applyUntyped(f, "r")),
    attempt(() => bindUntyped(f, "r")),
  );
}

function createTarget(name: string): Target {
  return function (this: unknown, a: number, b: number): string {
    return `${name}(${String(this)}, ${a}, ${b})`;
  };
}

function plain(this: unknown, a: number, b: number): string {
  return `plain(${String(this)}, ${a}, ${b})`;
}
const arrow: Target = (a, b) => `arrow(${a}, ${b})`;
const holder = {
  method(this: unknown, a: number, b: number): string {
    return `method(${String(this)}, ${a}, ${b})`;
  },
};

useAll("a declaration", plain);
useAll("an arrow function", arrow);
useAll("a method", holder.method);
useAll("a closure", createTarget("closure"));

const read: any = createTarget("read");
show("own properties read", read.name, read.length, typeof read.prototype, Object.getOwnPropertyNames(read).sort().join());
useAll("after its own properties were read", read);

const extended: any = createTarget("extended");
extended.extra = 1;
useAll("with another own property", extended);

const frozen = Object.freeze(createTarget("frozen"));
useAll("frozen", frozen);

const shadowed: any = createTarget("shadowed");
shadowed.call = () => "own call";
useAll("with an own call", shadowed);
shadowed.apply = () => "own apply";
shadowed.bind = () => () => "own bind";
useAll("with all three", shadowed);
delete shadowed.call;
delete shadowed.apply;
delete shadowed.bind;
useAll("with all three deleted", shadowed);

const accessor: any = createTarget("accessor");
let reads = 0;
Object.defineProperty(accessor, "call", {
  get() {
    reads++;
    return Function.prototype.call;
  },
});
useAll("with a getter for call", accessor);
show("the getter ran", reads);

const reparented: any = createTarget("reparented");
Object.setPrototypeOf(reparented, {
  call: () => "inherited call",
  apply: () => "inherited apply",
  bind: () => () => "inherited bind",
});
useAll("with another prototype", reparented);

const between: any = createTarget("between");
Object.setPrototypeOf(between, Object.create(Function.prototype, { apply: { value: () => "apply in between" } }));
useAll("with a prototype in between", between);

const orphan: any = createTarget("orphan");
Object.setPrototypeOf(orphan, null);
useAll("without a prototype", orphan);
show("called directly", orphan.length === undefined, Function.prototype.call.call(orphan, "r", 1, 2));

async function later(this: unknown, a: number, b: number): Promise<string> {
  return `later(${String(this)}, ${a}, ${b})`;
}
function* steps(this: unknown, a: number, b: number): Generator<string> {
  yield `steps(${String(this)}, ${a}, ${b})`;
}
show("an async function", await callTyped(later, "r"), await applyTyped(later, "r"), await bindTyped(later, "r"), await callUntyped(later, "r"));
show("a generator", (callTyped(steps, "r") as Generator<string>).next().value, (applyUntyped(steps, "r") as Generator<string>).next().value, (bindTyped(steps, "r") as Generator<string>).next().value);

useAll("a bound function", plain.bind("bound"));
useAll("a bound function with an argument", plain.bind("bound", 9));
useAll("a host function", Math.max);
useAll("a built-in written in JavaScript", Array.prototype.concat);

class Statics {
  static call(): string {
    return "static call";
  }
  static apply(): string {
    return "static apply";
  }
  static bind(): () => string {
    return () => "static bind";
  }
}
class Derived extends Statics {}
class Empty {}
useAll("a class with static methods", Statics);
useAll("a class that inherits them", Derived);
useAll("a class without them", Empty);

const trapped: string[] = [];
const proxy = new Proxy(plain, {
  get(target, key, receiver) {
    trapped.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
useAll("a proxy", proxy);
show("the proxy was asked for", trapped.join());

const changing: any = createTarget("changing");
const seen: unknown[] = [];
for (let round = 0; round < 6; round++) {
  if (round === 2) changing.call = () => "own call";
  if (round === 4) delete changing.call;
  seen.push(callTyped(changing, round), callUntyped(changing, round));
}
show("changed between calls", ...seen);

const mixed: any[] = [plain, shadowed, arrow, reparented, Statics, createTarget("last")];
show("one call site, many functions", ...mixed.map(f => callTyped(f, "r")));
show("not functions", attempt(() => callUntyped({ call: () => "a plain object" }, "r")), attempt(() => callUntyped({}, "r")), attempt(() => callUntyped(undefined, "r")), attempt(() => applyUntyped(5, "r")));
