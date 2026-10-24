function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function handBack(value) {
  return value;
}

class Vault {
  #code;
  label = "vault";
  constructor(code) {
    this.#code = code;
  }
  reveal() {
    return this.#code;
  }
  change(code) {
    this.#code = code;
    return this.#code;
  }
  #double() {
    return this.#code * 2;
  }
  doubled() {
    return this.#double();
  }
  static isVault(value) {
    return #code in value;
  }
  static revealOf(value) {
    return value.#code;
  }
  static same(one, other) {
    return one.#code === other.#code;
  }
}

class Stamp extends handBack {
  #ink = "stamped";
  static read(value) {
    return value.#ink;
  }
  static write(value, ink) {
    value.#ink = ink;
    return value.#ink;
  }
  static has(value) {
    return #ink in value;
  }
}

class LookAlike {
  #code;
  label = "vault";
  constructor(code) {
    this.#code = code;
  }
  reveal() {
    return "the look-alike's " + this.#code;
  }
}

const uses = [
  ["reveal()", value => value.reveal()],
  ["Vault's reveal with it as this", value => Vault.prototype.reveal.call(value)],
  ["Vault's change with it as this", value => Vault.prototype.change.call(value, 9)],
  ["Vault's doubled with it as this", value => Vault.prototype.doubled.call(value)],
  ["#code in it", value => Vault.isVault(value)],
  ["it.#code", value => Vault.revealOf(value)],
  ["compared with an honest one", value => Vault.same(new Vault(1), value)],
];

const values = [
  ["an honest vault", () => new Vault(1)],
  ["a subclass instance", () => new (class extends Vault {})(1)],
  ["a class of the same text", () => new LookAlike(1)],
  ["a literal", () => ({ label: "vault", reveal() { return "a literal"; } })],
  ["a literal under Vault.prototype", () => ({ __proto__: Vault.prototype, label: "vault" })],
  ["Object.create(Vault.prototype)", () => Object.create(Vault.prototype)],
  ["an object that inherits from a vault", () => Object.create(new Vault(1))],
  ["a proxy around a vault", () => new Proxy(new Vault(1), {})],
  ["a vault moved under Object.prototype", () => Object.setPrototypeOf(new Vault(1), Object.prototype)],
  ["a vault without a prototype", () => Object.setPrototypeOf(new Vault(1), null)],
  ["a frozen vault", () => Object.freeze(new Vault(1))],
  ["a structured clone of a vault", () => structuredClone(new Vault(1))],
  ["Reflect.construct of Vault for Object", () => Reflect.construct(Vault, [1], Object)],
  ["Reflect.construct of Object for Vault", () => Reflect.construct(Object, [], Vault)],
  ["a vault with a string", () => new Vault("1")],
  ["a number", () => 5],
  ["null", () => null],
];

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Vault(i % 9));

for (const [label, make] of values) {
  for (const [name, use] of uses) {
    let line = label + " | " + name + " -> ";
    try {
      line += show(use(make()));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line);
  }
}

const targets = [
  ["a literal", () => ({ plain: true })],
  ["a vault", () => new Vault(1)],
  ["an array", () => [1, 2]],
  ["a function", () => function target() {}],
  ["a frozen literal", () => Object.freeze({ plain: true })],
  ["a proxy", () => new Proxy({}, {})],
  ["an object without a prototype", () => Object.create(null)],
  ["the global object", () => globalThis],
  ["Vault.prototype", () => Vault.prototype],
];

for (let i = 0; i < 2000; i++) Stamp.read(new Stamp({ plain: true }));

for (const [label, make] of targets) {
  const target = make();
  const steps = [
    ["has the name before", () => Stamp.has(target)],
    ["read before", () => Stamp.read(target)],
    ["stamp", () => new Stamp(target) === target],
    ["has the name after", () => Stamp.has(target)],
    ["read after", () => Stamp.read(target)],
    ["write", () => Stamp.write(target, "again")],
    ["stamp twice", () => new Stamp(target) === target],
    ["own keys did not change", () => Reflect.ownKeys(target).includes("#ink")],
    ["instanceof Stamp", () => target instanceof Stamp],
  ];
  for (const [name, step] of steps) {
    let line = "stamping " + label + " | " + name + " -> ";
    try {
      line += show(step());
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line);
  }
}
for (const primitive of [5, "text", null, undefined]) {
  let line = "stamping " + show(primitive) + " -> ";
  try {
    const made = new Stamp(primitive);
    line += [typeof made, Stamp.has(made), made instanceof Stamp].join();
  } catch (error) {
    line += "threw " + error.constructor.name;
  }
  console.log(line);
}
