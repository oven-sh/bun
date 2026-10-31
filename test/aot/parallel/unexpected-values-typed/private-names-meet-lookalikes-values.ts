// Private names meet lookalikes values and receivers.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

class Vault {
  #secret: number;
  #log: string[] = [];
  static #made = 0;

  constructor(secret: number) {
    this.#secret = secret;
    Vault.#made++;
  }

  reveal(): number {
    return this.#secret + 1;
  }

  set(secret: number): void {
    this.#secret = secret;
  }

  #double(): number {
    return this.#secret * 2;
  }

  doubled(): number {
    return this.#double();
  }

  get #half(): number {
    return this.#secret / 2;
  }

  halved(): number {
    return this.#half;
  }

  same(other: Vault): boolean {
    return this.#secret === other.#secret;
  }

  sum(other: Vault): number {
    return this.#secret + other.#secret;
  }

  note(text: string): number {
    return this.#log.push(text);
  }

  static is(value: unknown): boolean {
    return typeof value === "object" && value !== null && #secret in value;
  }

  static made(): number {
    return Vault.#made;
  }

  static peek(v: Vault): number {
    return v.#secret;
  }
}

class Stamper {
  constructor(target: object) {
    return target;
  }
}

class Stamped extends Stamper {
  #mark = 7;
  static read(o: object): number {
    return (o as Stamped).#mark + 1;
  }
  static has(o: object): boolean {
    return #mark in o;
  }
}

function honest(label: string): void {
  const a = new Vault(4);
  const b = new Vault(4);
  console.log(label, a.reveal(), a.doubled(), a.halved(), a.same(b), a.sum(b), a.note("n"), Vault.is(a), Vault.peek(a));
}

honest("honest before");
let warm = 0;
const busy = new Vault(1);
for (let i = 0; i < 2000; i++) {
  busy.set(i);
  warm += busy.reveal() + busy.doubled() + busy.halved() + busy.sum(busy) + Vault.peek(busy);
}
console.log("2000 honest rounds", warm);

for (const text of ["3", "'3'", "3n", "-0", "null", "undefined", "{ valueOf() { note('valueOf'); return 3; } }"]) {
  attempt("constructed with " + text, () => {
    const v = new Vault(hidden(text));
    return [v.reveal(), v.doubled(), v.halved(), v.same(new Vault(3)), v.sum(new Vault(1))];
  });
  attempt("set to " + text, () => {
    const v = new Vault(1);
    v.set(hidden(text));
    return [v.reveal(), Vault.peek(v)];
  });
}

(globalThis as any).Vault = Vault;
const receivers = ["{}", "{ secret: 1 }", "Object.create(Vault.prototype)", "new Proxy(new Vault(1), {})", "Object.setPrototypeOf({}, Vault.prototype)", "structuredClone(new Vault(1))", "Object.assign({}, new Vault(1))", "null", "5", "Vault"];
for (const text of receivers) {
  attempt("reveal.call " + text, () => Vault.prototype.reveal.call(hidden(text)));
  attempt("doubled.call " + text, () => Vault.prototype.doubled.call(hidden(text)));
  attempt("set.call " + text, () => Vault.prototype.set.call(hidden(text), 1));
  attempt("same " + text, () => new Vault(1).same(hidden(text)));
  attempt("peek " + text, () => Vault.peek(hidden(text)));
  attempt("is " + text, () => Vault.is(hidden(text)));
}

attempt("a vault whose prototype was removed keeps its private names", () => {
  const v = new Vault(4);
  Object.setPrototypeOf(v, null);
  return [Vault.peek(v), Vault.is(v), Vault.prototype.reveal.call(v)];
});
attempt("a frozen vault can still be set", () => {
  const v = Object.freeze(new Vault(4));
  v.set(5);
  return v.reveal();
});
attempt("a private name stamped on a literal", () => {
  const o = { plain: true };
  new Stamped(o);
  return [Stamped.has(o), Stamped.read(o), Object.keys(o)];
});
attempt("stamped on an array, a function and a proxy", () => {
  const targets: object[] = [[1], () => 1, new Proxy({}, {})];
  for (const t of targets) new Stamped(t);
  return targets.map(t => Stamped.read(t));
});
attempt("stamped twice", () => {
  const o = {};
  new Stamped(o);
  new Stamped(o);
  return "no error";
});
attempt("never stamped", () => [Stamped.has({}), Stamped.read({})]);
attempt("made", () => Vault.made() > 2000);

honest("honest after");
