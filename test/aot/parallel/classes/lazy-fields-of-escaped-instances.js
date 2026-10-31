const suffix = process.argv.length > 99 ? ";" : "";
let calls = 0;
const count = () => ++calls;
const opaque = new Function("count", "return function (value) { count(); return value; }" + suffix)(count);

class Settings {
  constructor(given) {
    this.id = 1;
    this.log = [];
    this.configure = next => {
      const before = this.options;
      this.options = next;
      this.strict = next.strict ?? true;
      if (!this.origin) this.origin = "local";
      const base = next.base ?? "/";
      if (this.base !== base || before?.strict !== next.strict) {
        this.base = base;
        this.prefix = base === "/" ? undefined : base;
      }
      if (!this.history) this.history = [base];
      return before;
    };
    if (given) this.configure(given);
  }
  reset(next) {
    const before = this.cache;
    this.cache = next;
    if (!this.owner) this.owner = "nobody";
    this.stamp = before === undefined ? "first" : "again";
    this.flag = "reset";
    this.label = 7;
    return before;
  }
  merge(next) {
    const before = this.merged;
    opaque(before);
    this.merged = { ...before, ...next };
    opaque(next);
    this.mode = next.mode ?? "plain";
    opaque(next);
    const seen = this.target;
    opaque(seen);
    this.target = next.target;
    opaque(next);
    const limit = this.limit;
    opaque(limit);
    this.limit = next.limit;
    opaque(next);
    this.flag = true;
    opaque(next);
    this.label = "merged";
    opaque(next);
    return [before === undefined ? "none" : Object.keys(before).join(), String(seen), String(limit)].join("/");
  }
}
class Derived extends Settings {
  constructor(given) {
    super(given);
    this.extra = "derived";
  }
}

const evaluate = text => new Function("o", "Settings", "Derived", text + suffix);

function describe(o) {
  const own = Object.getOwnPropertyNames(o)
    .filter(name => name !== "configure" && name !== "log")
    .map(name => {
      const d = Object.getOwnPropertyDescriptor(o, name);
      const flags = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
      return name + ":" + ("value" in d ? JSON.stringify(d.value) : "accessor") + ":" + flags;
    });
  return own.join(" ") + " | log " + o.log.join(",");
}

function attempt(label, make, text, after) {
  const o = make();
  evaluate(text)(o, Settings, Derived);
  const lines = [];
  for (const step of [() => o.merge({ mode: "m", target: "t" }), () => o.configure({ strict: false, base: "/app" }), () => o.reset("one"), () => o.merge({ limit: 3 }), () => o.configure({ base: "/" }), () => o.reset("two")]) {
    try {
      lines.push(JSON.stringify(step()) ?? "undefined");
    } catch (error) {
      lines.push("threw " + error.constructor.name);
    }
  }
  console.log(label, "|", lines.join(" "), "|", describe(o), "| reads", String(o.origin), String(o.base), String(o.owner), String(o.cache), String(o.mode), String(o.target), String(o.limit), calls);
  if (after) evaluate(after)(o, Settings, Derived);
}

const makers = {
  empty: () => new Settings(),
  filled: () => new Settings({ strict: true }),
  derived: () => new Derived(),
  "derived filled": () => new Derived({ base: "/d" }),
  "other new.target": () => Reflect.construct(Settings, [], class Other {}),
};

for (const [name, make] of Object.entries(makers)) {
  attempt(name + ", untouched", make, "");
  attempt(name + ", frozen", make, "Object.freeze(o)");
  attempt(name + ", sealed", make, "Object.seal(o)");
  attempt(name + ", not extensible", make, "Object.preventExtensions(o)");
  attempt(name + ", fields deleted", make, "delete o.options; delete o.origin; delete o.base; delete o.id; delete o.merged; delete o.mode");
  attempt(name + ", extra properties first", make, "o.zebra = 1; o.apple = 2");
  attempt(name + ", an index first", make, "o[3] = 'three'; o[1] = 'one'");
  attempt(name + ", a symbol first", make, "o[Symbol.for('s')] = 1");
  attempt(name + ", own accessor", make, "for (const k of ['origin', 'mode', 'target']) Object.defineProperty(o, k, { get() { return 'own getter'; }, set(v) { this.log.push('own setter ' + k + ' ' + v); }, configurable: true, enumerable: true })");
  attempt(name + ", own read-only", make, "for (const k of ['cache', 'mode', 'limit']) Object.defineProperty(o, k, { value: 'fixed', writable: false, configurable: true })");
  attempt(name + ", own hidden", make, "Object.defineProperty(o, 'owner', { value: '', writable: true, enumerable: false, configurable: true })");
  attempt(name + ", own undefined", make, "o.origin = undefined; o.options = undefined; o.cache = undefined; o.merged = undefined; o.target = undefined");
  attempt(name + ", another prototype", make, "Object.setPrototypeOf(o, { reset: Settings.prototype.reset, merge: Settings.prototype.merge, get origin() { return 'inherited'; }, set origin(v) { this.log.push('inherited setter ' + v); }, owner: 'from above', get target() { return 'target above'; }, set target(v) { this.log.push('target setter ' + v); }, limit: 'limit above', merged: { from: 'above' } })");
  attempt(name + ", no prototype", make, "Object.setPrototypeOf(o, null); o.reset = Settings.prototype.reset; o.merge = Settings.prototype.merge");
  attempt(name + ", read-only above", make, "Object.setPrototypeOf(o, Object.create(Settings.prototype, { cache: { value: 'above', writable: false }, mode: { value: 'mode above', writable: false }, target: { value: 'target above', writable: false } }))");
  attempt(
    name + ", a proxy above",
    make,
    "Object.setPrototypeOf(o, new Proxy(Settings.prototype, { set(t, k, v, r) { r.log.push('trap set ' + String(k)); return Reflect.set(t, k, v, r); }, get(t, k, r) { return k === 'owner' || k === 'target' || k === 'limit' ? 'from the trap' : Reflect.get(t, k, r); } }))",
  );
}

for (const [name, make] of Object.entries(makers)) {
  attempt(
    name + ", a setter on the class",
    make,
    "for (const k of ['origin', 'mode', 'target']) Object.defineProperty(Settings.prototype, k, { get() { return k === 'target' ? 'class getter' : undefined; }, set(v) { this.log.push('class setter ' + k + ' ' + v); }, configurable: true })",
    "delete Settings.prototype.origin; delete Settings.prototype.mode; delete Settings.prototype.target",
  );
  attempt(name + ", after the setter is gone", make, "");
  attempt(name + ", a value on the class", make, "Settings.prototype.owner = 'class value'; Settings.prototype.history = 0; Settings.prototype.target = 'class target'; Settings.prototype.limit = 9; Settings.prototype.merged = { from: 'class' }", "delete Settings.prototype.owner; delete Settings.prototype.history; delete Settings.prototype.target; delete Settings.prototype.limit; delete Settings.prototype.merged");
  attempt(name + ", read-only on the class", make, "for (const k of ['cache', 'mode', 'limit']) Object.defineProperty(Settings.prototype, k, { value: 'class fixed', writable: false, configurable: true })", "delete Settings.prototype.cache; delete Settings.prototype.mode; delete Settings.prototype.limit");
  attempt(name + ", a setter on the class below", make, "for (const k of ['stamp', 'mode', 'limit']) Object.defineProperty(Derived.prototype, k, { get() { return 'derived getter'; }, set(v) { this.log.push('derived setter ' + k + ' ' + v); }, configurable: true })", "delete Derived.prototype.stamp; delete Derived.prototype.mode; delete Derived.prototype.limit");
  attempt(name + ", the class chain is cut", make, "Object.setPrototypeOf(Derived.prototype, { reset: Settings.prototype.reset, merge: Settings.prototype.merge, set owner(v) { this.log.push('new base setter ' + v); }, get target() { return 'new base getter'; }, set target(v) { this.log.push('new base setter target ' + v); } })", "Object.setPrototypeOf(Derived.prototype, Settings.prototype)");
  attempt(name + ", all as at first", make, "");
}

const orders = [];
for (let turn = 0; turn < 6; turn++) {
  const o = turn % 2 ? new Derived() : new Settings();
  if (turn % 3 === 0) o.reset("r");
  if (turn % 2 === 0) o.merge({ target: turn });
  o.configure({ base: turn % 2 ? "/" : "/x" });
  if (turn % 3 === 1) o.reset("r");
  if (turn === 4) delete o.origin;
  o.configure({ strict: turn > 2 });
  o.reset("s");
  o.merge({ mode: "late" });
  orders.push(Object.keys(o).join());
  let listed = "";
  for (const key in o) listed += key[0];
  orders.push(listed + " " + JSON.stringify({ ...o, configure: 0 }).length);
}
console.log(orders.join("\n"));

let total = 0;
for (let turn = 0; turn < 20000; turn++) {
  const o = turn % 7 ? new Settings({ base: "/" }) : new Derived({ strict: false });
  o.configure({ base: turn % 5 ? "/a" : "/" });
  o.reset(turn);
  o.merge({ limit: turn % 3 });
  if (turn % 4 === 0) o.merge({ target: turn });
  total += Object.keys(o.merged).length + (o.target === undefined ? 1 : 2) + o.base.length + o.history.length + (o.prefix === undefined ? 1 : 2) + Object.keys(o).length + (o.reset(0) === turn ? 1 : 100);
}
console.log(total);
