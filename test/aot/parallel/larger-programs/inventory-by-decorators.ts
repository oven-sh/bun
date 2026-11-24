// Standard decorators over classes: registered commands, checked arguments, logged calls, cached getters, observed accessors, injected services, roles, events that are stored and replayed
type Ctor<T = object> = new (...all: any[]) => T;
interface CommandInfo {
  name: string;
  method: string;
  roles: readonly string[];
  checks: ((v: unknown) => string | null)[]
}
const commandsOf = new WeakMap<object, Map<string, CommandInfo>>();
const trace: string[] = [];
class Denied extends Error {
  constructor(readonly role: string, command: string) {
    super(`${role} may not ${command}`);
    this.name = "Denied";
  }
}
class BadArgument extends TypeError {
  constructor(readonly index: number, message: string) {
    super(`argument ${index + 1} ${message}`);
    this.name = "BadArgument";
  }
}
function infoOf(metadata: object, method: string): CommandInfo {
  let map = commandsOf.get(metadata);
  if (!map) commandsOf.set(metadata, (map = new Map()));
  let info = map.get(method);
  if (!info) map.set(method, (info = { name: method, method, roles: [], checks: [] }));
  return info;
}
const registry = new Map<string, Map<string, CommandInfo>>();
const pending = new Map<string, CommandInfo>();
function info(name: string): CommandInfo {
  let i = pending.get(name);
  if (!i) pending.set(name, (i = { name, method: name, roles: [], checks: [] }));
  return i;
}
function command(label?: string) {
  return function <This, A extends any[], R>(method: (this: This, ...all: A) => R,
    context: ClassMethodDecoratorContext<This, (this: This, ...all: A) => R>) {
    const i = info(String(context.name));
    if (label) i.name = label;
    return function (this: This, ...all: A): R {
      i.checks.forEach((check, k) => {
        const wrong = check(all[k]);
        if (wrong) throw new BadArgument(k, wrong);
    });
      return method.apply(this, all);
  };
};
}
function roles(...names: string[]) {
  return function (_: Function, context: ClassMethodDecoratorContext) {
    info(String(context.name)).roles = names;
};
}
function checks(...list: ((v: unknown) => string | null)[]) {
  return function (_: Function, context: ClassMethodDecoratorContext) {
    info(String(context.name)).checks = list;
};
}
function logged<This, A extends any[], R>(method: (this: This, ...all: A) => R,
  context: ClassMethodDecoratorContext): (this: This, ...all: A) => R {
  const name = String(context.name);
  return function (this: This, ...all: A): R {
    trace.push(name + "(" + all.map(x => JSON.stringify(x)).join() + ")");
    try {
      const r = method.apply(this, all);
      trace.push(name + "=" + JSON.stringify(r));
      return r;
  } catch (e) {
      trace.push(name + "!" + (e as Error).message);
      throw e;
    }
};
}
function cached<This extends object, V>(getter: (this: This) => V,
  context: ClassGetterDecoratorContext<This, V>) {
  const kept = new WeakMap<This, {
    version: number;
    value: V
  }
  >();
  return function (this: This): V {
    const version = (this as { version?: number }).version ?? 0;
    const k = kept.get(this);
    if (k && k.version === version) return k.value;
    const value = getter.call(this);
    kept.set(this, { version, value });
    trace.length < 400 && trace.push("computed " + String(context.name));
    return value;
};
}
function observed<This, V>(target: ClassAccessorDecoratorTarget<This, V>,
  context: ClassAccessorDecoratorContext<This, V>): ClassAccessorDecoratorResult<This, V> {
  const name = String(context.name);
  return {
    get(this: This) {
      return target.get.call(this);
  }, set(this: This, value: V) {
      const old = target.get.call(this);
      target.set.call(this, value);
      if (!Object.is(old, value)) (this as any).changed?.(name, old, value);
  }, init(this: This, value: V) {
      return value;
    }
};
}
function limited(low: number, high: number) {
  return function <This>(_: undefined, context: ClassFieldDecoratorContext<This, number>) {
    return function (this: This, value: number): number {
      if (value < low ||
        value > high) throw new RangeError(`${String(context.name)} must be in ${low}..${high}`);
      return value;
  };
};
}
function bound<This>(_: Function, context: ClassMethodDecoratorContext<This>) {
  context.addInitializer(function (this: any) {
    this[context.name] = this[context.name].bind(this);
});
}
function service(name: string) {
  return function <T extends Ctor>(type: T, context: ClassDecoratorContext<T>): T {
    const own = new Map(pending);
    pending.clear();
    registry.set(name, own);
    context.addInitializer(function () {
      trace.push("registered " + name + ":" + [...own.keys()].join());
  });
    return class extends type {
      static readonly serviceName = name;
      static made = 0;
      constructor(...all: any[]) {
        super(...all);
        (this.constructor as any).made++;
      }
  };
};
}
const is = {
  text: (v: unknown) => (typeof v === "string" && v ? null : "must be a text"),
    count: (v: unknown) => (Number.isInteger(v) &&
    (v as number) > 0 ? null : "must be a whole number above 0"),
    price: (v: unknown) => (typeof v === "number" && v >= 0 ? null : "must be a price"),
    any: () => null
};
interface Item {
  sku: string;
  count: number;
  price: number;
  reserved: number
}
type StoredEvent = {
  seq: number;
  command: string;
  all: unknown[];
  role: string;
  ok: boolean
};
abstract class Observable {
  readonly #watchers = new Set<(name: string, old: unknown, value: unknown) => void>();
  version = 0;
  watch(f: (name: string, old: unknown, value: unknown) => void) {
    this.#watchers.add(f);
    return () => void this.#watchers.delete(f);
  }
  changed(name: string, old: unknown, value: unknown) {
    this.version++;
    for (const f of this.#watchers) f(name, old, value);
  }
}
@service("inventory") class Inventory extends Observable {
  readonly items = new Map<string, Item>();
  @observed accessor open = true;
  @observed accessor moved = 0;
  @limited(1, 1000) capacity: number = 60;
  constructor(readonly title: string) {
    super();
  }
  #need(sku: string): Item {
    const i = this.items.get(sku);
    if (!i) throw new ReferenceError("no item " + sku);
    return i;
  }
  @command() @roles("clerk", "admin") @checks(is.text, is.count, is.price) receive(sku: string,
    count: number, price: number): number {
    if (!this.open) throw new Error("is closed");
    if (this.total + count > this.capacity * 10) throw new RangeError("no room for " + count);
    const i = this.items.get(sku);
    if (i) {
      i.price = Math.round((i.price * i.count + price * count) / (i.count + count) * 100) / 100;
      i.count += count;
  } else this.items.set(sku, { sku, count, price, reserved: 0 });
    this.moved += count;
    return this.items.get(sku)!.count;
  }
  @command("take-out") @roles("clerk", "admin") @checks(is.text,
    is.count) @logged take(sku: string, count: number): number {
    const i = this.#need(sku);
    if (i.count - i.reserved < count) throw new RangeError(`only ${i.count - i.reserved} of ${sku}`);
    i.count -= count;
    this.moved += count;
    if (i.count === 0) this.items.delete(sku);
    return i.count;
  }
  @command() @roles("clerk", "admin", "guest") @checks(is.text, is.count) reserve(sku: string,
    count: number): number {
    const i = this.#need(sku);
    if (i.reserved + count > i.count) throw new RangeError("cannot reserve " + count);
    i.reserved += count;
    this.version++;
    return i.reserved;
  }
  @command() @roles("admin") close(): boolean {
    this.open = false;
    return this.open;
  }
  @command() @roles("admin") @bound reopen(): boolean {
    this.open = true;
    return this.open;
  }
  @cached get total(): number {
    let n = 0;
    for (const i of this.items.values()) n += i.count;
    return n;
  }
  @cached get value(): number {
    let v = 0;
    for (const { count, price } of this.items.values()) v += count * price;
    return Math.round(v * 100) / 100;
  }
}
@service("audit") class Audit {
  readonly notes: string[] = [];
  @command() @roles("admin") @checks(is.text) note(text: string): number {
    return this.notes.push(text);
  }
  @command("show-last") @roles("admin", "clerk") last(n: number = 1): string {
    return this.notes.slice(-n).join("|");
  }
}
class Dispatcher {
  readonly events: StoredEvent[] = [];
  readonly #services = new Map<string, any>();
  counts: Record<string, number> = {
};
  add(name: string, s: object): this {
    if (!registry.has(name)) throw new ReferenceError("no service " + name);
    this.#services.set(name, s);
    return this;
  }
  run(role: string, text: string, ...all: unknown[]): unknown {
    const [name, label] = text.split(".");
    const target = this.#services.get(name), own = registry.get(name);
    const i = own && [...own.values()].find(x => x.name === label);
    const record = (ok: boolean) => {
      this.events.push({ seq: this.events.length, command: text, all, role, ok });
      const k = (ok ? "" : "!") + text;
      this.counts[k] = (this.counts[k] ?? 0) + 1;
  };
    try {
      if (!target || !i) throw new ReferenceError("no command " + text);
      if (!i.roles.includes(role)) throw new Denied(role, text);
      const r = target[i.method](...all);
      record(true);
      return r;
  } catch (e) {
      record(false);
      throw e;
    }
  }
  try(role: string, text: string, ...all: unknown[]): string {
    try {
      return String(this.run(role, text, ...all));
  } catch (e) {
      return `${(e as Error).name}: ${(e as Error).message}`;
    }
  }
  replay(into: Dispatcher): number {
    let n = 0;
    for (const e of this.events) if (e.ok) {
      into.run(e.role, e.command, ...e.all);
      n++;
    }
    return n;
  }
  help(): string {
    return [...registry].map(([s,
      own]) => s + ": " + [...own.values()].map(i => `${i.name}/${i.checks.length}(${i.roles.join("+")})`).join(" ")).join("; ");
  }
}
console.log(trace.splice(0).join(" "));
const inventory = new Inventory("main"), audit = new Audit();
const d = new Dispatcher().add("inventory", inventory).add("audit", audit);
console.log(d.help(), (Inventory as any).serviceName, Inventory.name.length > 0);
let changes = 0;
const stop = inventory.watch((name, old, value) => {
  changes++;
  if (name === "open") trace.push(`open ${old}>${value}`);
});
for (const [role, text, ...all] of [["clerk", "inventory.receive", "nuts", 10, 1.5], ["guest",
  "inventory.receive", "x", 1, 1], ["clerk", "inventory.receive", "", 1, 1], ["clerk",
  "inventory.receive", "nuts", 1.5, 1], ["clerk", "inventory.receive", "nuts", 5, 3], ["clerk",
  "inventory.take-out", "nuts", 4], ["clerk", "inventory.take", "nuts", 4], ["guest",
  "inventory.reserve", "nuts", 9], ["clerk", "inventory.take-out", "nuts", 4], ["clerk",
  "inventory.take-out", "bolts", 1], ["clerk", "inventory.close"], ["admin",
  "inventory.close"], ["clerk", "inventory.receive", "nuts", 1, 1], ["admin",
  "inventory.reopen"], ["admin", "audit.note", "first"], ["admin", "audit.note"], ["clerk",
  "audit.show-last"], ["clerk", "nothing.here"], ["clerk", "inventory.receive", "lots", 10000,
  1]] as [string, string, ...unknown[]][]) console.log(role, text, all.join(), "=>",
  d.try(role, text, ...all));
console.log(inventory.total, inventory.value, inventory.moved, changes,
  trace.splice(0).join(" "));
const {
  reopen
} = inventory;
console.log(reopen(), inventory.open);
let mixed = 0;
for (let i = 0; i < 12000; i++) {
  const role = ["clerk", "admin", "guest"][i % 3], sku = "sku" + ((i * 7) % 23);
  const text = d.try(role, ["inventory.receive", "inventory.take-out", "inventory.reserve",
    "audit.note", "inventory.receive"][(i * 11) % 5],
    ...((i * 11) % 5 === 3 ? ["n" + i] : [sku, 1 + (i % 9), (i % 50) / 4]));
  mixed = (mixed * 31 + text.length) >>> 0;
  if (i % 100 === 0) mixed = (mixed + inventory.total + Math.round(inventory.value)) >>> 0;
  if (i === 6000) stop();
  trace.length = Math.min(trace.length, 200);
}
console.log(mixed, changes, inventory.items.size, inventory.total, inventory.value,
  JSON.stringify(Object.entries(d.counts).sort()).slice(0, 200));
const copy = new Inventory("copy"), other = new Dispatcher().add("inventory",
  copy).add("audit", new Audit());
console.log(d.replay(other), copy.total === inventory.total, copy.value === inventory.value,
  other.events.length, (Inventory as any).made, (Audit as any).made);
class Small extends Observable {
  @limited(1, 5) size = 3;
  @observed accessor n = 1;
}
const small = new Small();
small.n = 1;
small.n = 2;
console.log(small.version, small.size, Object.keys(small).join());
try {
  class Broken {
    @limited(1, 5) size = 9;
  }
  new Broken();
} catch (e) {
  console.log((e as Error).message);
}
try {
  new Dispatcher().add("none", {});
} catch (e) {
  console.log((e as Error).message);
}
