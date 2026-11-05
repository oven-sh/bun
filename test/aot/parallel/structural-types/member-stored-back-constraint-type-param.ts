// A member is stored back through the constraint of a type parameter.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const log: string[] = [];

function renumber<T extends { id: number }>(item: T, id: number): T {
  item.id = id;
  return item;
}

function renumberAll<T extends { id: number }>(items: T[]): T[] {
  for (let i = 0; i < items.length; i++) items[i].id = i + 0.5;
  return items;
}

enum Id {
  First = 1,
  Second = 2,
}

class WithGetter {
  get id(): number {
    log.push("get");
    return 1;
  }
}

class WithBoth {
  private kept = 1;
  get id(): number {
    log.push("get");
    return this.kept;
  }
  set id(value: number) {
    log.push("set " + value);
    this.kept = value * 10;
  }
}

class WithReadonly {
  readonly id: number = 1;
  twice(): number {
    return this.id * 2;
  }
}

class Sub extends WithReadonly {
  name = "sub";
}

function study<T extends { id: number }>(title: string, item: T, after: (item: T) => unknown): void {
  log.length = 0;
  attempt(title, () => {
    const same = renumber(item, 99);
    return [same === item, same.id, typeof same.id, Object.keys(same), JSON.stringify(same), after(same), log.join()];
  });
}

let total = 0;
for (let i = 0; i < 2000; i++) total += renumber({ id: 0, name: "n" }, i).id;
console.log("2000 honest rounds: " + total);

study("a plain member", { id: 1, name: "n" }, item => item.name.length + item.id);
const literal: { id: 1 | 2 } = { id: 1 };
study("a member of a literal type", literal, item => (item.id === 1 ? "one" : item.id === 2 ? "two" : "neither: " + show(item.id)));
const numbered: { id: Id } = { id: Id.First };
study("a member of an enum type", numbered, item => [Id[item.id], item.id === Id.First || item.id === Id.Second]);
study("a getter alone", new WithGetter(), item => item.id);
study("a getter and a setter", new WithBoth(), item => item.id);
study("a readonly field", new WithReadonly(), item => item.twice());
study("a readonly field of the base", new Sub(), item => item.twice() + item.name);
study("a frozen object", Object.freeze({ id: 1 }), item => item.id);
study("a sealed object", Object.seal({ id: 1 }), item => item.id);
const inherits: { id: number } = Object.create({ id: 1 });
study("an inherited member", inherits, item => [Object.hasOwn(item, "id"), Object.getPrototypeOf(item).id]);
study("an array with an id", Object.assign([1, 2], { id: 1 }), item => item.length + item.id);
study("a function with an id", Object.assign(() => 5, { id: 1 }), item => item() + item.id);

attempt("fractions for a list of literal ids", () => {
  const items: { id: 0 | 1 | 2 }[] = [{ id: 0 }, { id: 1 }, { id: 2 }];
  return renumberAll(items).map(item => (item.id === 0 || item.id === 1 || item.id === 2 ? "inside" : "outside " + show(item.id)));
});

export {};
