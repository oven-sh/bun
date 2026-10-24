// Text run by a direct eval in a class body reads, stores, tests and calls the private members of objects that compiled code created, and compiled code sees what the text stored.
function attempt(action: () => unknown): string {
  try {
    return JSON.stringify(action()) ?? "undefined";
  } catch (error) {
    return (error as Error).name;
  }
}

class Vault {
  #x = 1;
  #anything: unknown = "initial";
  label = "vault";
  static #count = 0;
  #m(): string {
    return "m sees " + this.#x;
  }
  get #a(): number {
    return this.#x * 10;
  }
  set #a(value: number) {
    this.#x = value / 10;
  }
  static #s(): string {
    return "s sees " + Vault.#count;
  }

  run(text: string, o?: unknown, v?: unknown): unknown {
    return eval(text);
  }
  static run(text: string, o?: unknown, v?: unknown): unknown {
    return eval(text);
  }
  runInArrow(text: string, o?: unknown, v?: unknown): unknown {
    return (() => eval(text))();
  }
  readConstantText(): unknown {
    return eval("this.#x");
  }
  storeConstantText(v: number): unknown {
    return eval("this.#x = v");
  }
  hasConstantText(o: unknown): unknown {
    return eval("#x in o");
  }
  callConstantText(): unknown {
    return eval("this.#m()");
  }

  compiled(): string {
    return [this.#x, JSON.stringify(this.#anything), this.#m(), this.#a, this.label].join(" ");
  }
  storeCompiled(value: number): void {
    this.#x = value;
  }
  static hasCompiled(o: object): string {
    return [#x in o, #anything in o, #m in o, #a in o].join();
  }
  static countCompiled(): string {
    return Vault.#count + " " + Vault.#s();
  }
}
class SafeBox extends Vault {
  extra = "subclass";
}
class Other {
  #x = "x of another class";
  read(): string {
    return this.#x;
  }
}

function exercise(kind: string, create: () => Vault): void {
  const vault = create();
  console.log(kind);
  console.log("  read:", attempt(() => vault.run("this.#x")), attempt(() => vault.run("this.#anything")), attempt(() => vault.run("o.#x", vault)), attempt(() => vault.runInArrow("this.#x")));
  console.log("  compiled after the read:", attempt(() => vault.compiled()), Vault.hasCompiled(vault));
  console.log("  store:", attempt(() => vault.run("this.#x = v", null, 2)), attempt(() => vault.compiled()));
  console.log("  store:", attempt(() => vault.run("o.#x = v", vault, 3)), attempt(() => vault.runInArrow("this.#x = v + 1", null, 3)), attempt(() => vault.compiled()));
  console.log("  update:", attempt(() => vault.run("this.#x += v", null, 5)), attempt(() => vault.run("this.#x++")), attempt(() => vault.run("--this.#x")), attempt(() => vault.compiled()));
  console.log("  other types:", ["text", 1.5, null, [1, 2], { k: 1 }, true].map(value => attempt(() => vault.run("this.#anything = v", null, value)) + " " + attempt(() => vault.compiled())).join(" | "));
  vault.storeCompiled(6);
  console.log("  read after a compiled store:", attempt(() => vault.run("this.#x")), attempt(() => vault.run("this.#m()")), attempt(() => vault.run("this.#a")));
  console.log("  in:", attempt(() => vault.run("[#x in o, #anything in o, #m in o, #a in o]", vault)), attempt(() => vault.run("#x in this")));
  console.log("  call:", attempt(() => vault.run("this.#m()")), attempt(() => vault.run("o.#m()", vault)), attempt(() => vault.run("this.#m.call(o)", create())), attempt(() => vault.run("this.#m === o.#m", create())));
  console.log("  accessor:", attempt(() => vault.run("this.#a")), attempt(() => vault.run("this.#a = v", null, 70)), attempt(() => vault.compiled()));
  console.log("  not allowed:", attempt(() => vault.run("this.#m = v", null, 1)), attempt(() => vault.run("delete this.label")), attempt(() => vault.compiled()), Vault.hasCompiled(vault));
  console.log("  constant text:", attempt(() => vault.readConstantText()), attempt(() => vault.storeConstantText(8)), attempt(() => vault.hasConstantText(vault)), attempt(() => vault.callConstantText()), attempt(() => vault.compiled()));
}

exercise("instance", () => new Vault());
exercise("instance of a subclass", () => new SafeBox());
exercise("instance with an added property", () => Object.assign(new Vault(), { added: 1 }));
exercise("frozen instance", () => {
  const vault = new Vault();
  Object.freeze(vault);
  return vault;
});
exercise("sealed instance", () => Object.seal(new Vault()));
exercise("instance used by compiled code first", () => {
  const vault = new Vault();
  vault.storeCompiled(1);
  vault.compiled();
  return vault;
});

const probe = new Vault();
const otherValues: [string, unknown][] = [
  ["plain object", {}],
  ["instance of another class", new Other()],
  ["object that inherits from an instance", Object.create(new Vault())],
  ["proxy of an instance", new Proxy(new Vault(), {})],
  ["the class", Vault],
  ["array", [1]],
  ["function", () => 1],
];
for (const [kind, otherValue] of otherValues) {
  console.log(`${kind}:`, attempt(() => probe.run("#x in o", otherValue)), attempt(() => probe.run("#m in o", otherValue)), attempt(() => probe.run("o.#x", otherValue)), attempt(() => probe.run("o.#x = v", otherValue, 1)), attempt(() => probe.run("o.#m()", otherValue)), attempt(() => probe.run("o.#a", otherValue)));
}
for (const primitive of [1, "text", null, undefined, true, 1n]) {
  console.log(`${typeof primitive}:`, attempt(() => probe.run("#x in o", primitive)), attempt(() => probe.run("o.#x", primitive)), attempt(() => probe.run("o.#m()", primitive)));
}

console.log("static:", attempt(() => Vault.run("Vault.#count")), attempt(() => Vault.run("this.#count = v", null, 4)), Vault.countCompiled());
console.log("static:", attempt(() => Vault.run("Vault.#count++")), attempt(() => Vault.run("this.#s()")), attempt(() => Vault.run("[#count in Vault, #s in Vault, #count in o, #x in Vault]", new Vault())), Vault.countCompiled());
console.log("static through a subclass:", attempt(() => SafeBox.run("this.#count")), attempt(() => SafeBox.run("Vault.#count")), attempt(() => SafeBox.run("this.#s()")), attempt(() => SafeBox.run("#count in this")));
console.log("from an instance method:", attempt(() => probe.run("Vault.#count = v", null, 9)), attempt(() => probe.run("Vault.#s()")), Vault.countCompiled());

const many: Vault[] = [];
for (let i = 0; i < 200; i++) many.push(i % 2 ? new SafeBox() : new Vault());
let sum = 0;
for (let i = 0; i < many.length; i++) {
  if (i % 3 === 0) many[i].run("this.#x = v", null, i);
  sum += many[i].run("this.#x") as number;
  many[i].storeCompiled(i % 7);
  sum += many[i].run("#m in this ? this.#x : -1000") as number;
}
console.log("200 objects:", sum, new Other().read());

export {};
