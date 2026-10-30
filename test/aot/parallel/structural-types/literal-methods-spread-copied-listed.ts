// A literal with methods is spread copied and listed.
function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const counter = {
  count: 1,
  label: "counter",
  read(): number {
    return this.count;
  },
  bump(): number {
    return ++this.count;
  },
  title(): string {
    return this.label.toUpperCase();
  },
  get doubled(): number {
    return this.count * 2;
  },
};

show("honest read", () => counter.read());
show("honest doubled", () => counter.doubled);

const copy = { ...counter };
copy.count = 100;
show("spread: read follows the copy", () => copy.read());
show("spread: bump", () => copy.bump());
show("spread: the getter became a value", () => copy.doubled);
show("spread: the original", () => counter.count);

const assigned = Object.assign({}, counter, { count: 200 });
show("assign: read", () => assigned.read());
show("assign: doubled", () => assigned.doubled);

const overridden = { ...counter, count: "many", label: 5 };
show("fields of other kinds: read", () => overridden.read());
show("fields of other kinds: bump", () => overridden.bump());
show("fields of other kinds: title", () => overridden.title());
show("fields of other kinds: count", () => overridden.count);

const { read, bump, title, ...rest } = counter;
show("destructured: read", () => read());
show("destructured: bump", () => bump());
show("destructured: title", () => title());
show("the rest", () => Object.keys(rest).join());

show("values, called bare", () =>
  Object.values({ read: counter.read, bump: counter.bump })
    .map(f => {
      try {
        return String(f());
      } catch (error) {
        return "threw";
      }
    })
    .join(),
);
show("values, called as elements", () => {
  const values = Object.values({ read: counter.read, bump: counter.bump });
  return String(values[0]()) + " " + String(values[1]()) + " " + Object.keys(values).join();
});
show("entries into a map", () => {
  const table = new Map(Object.entries({ read: counter.read }));
  return table.get("read")?.();
});
const child: typeof counter = Object.create(counter);
show("a child: read", () => child.read());
show("a child: bump lands on the child", () => child.bump() + " " + counter.count + " " + Object.keys(child).join());
show("a child: doubled", () => child.doubled);
