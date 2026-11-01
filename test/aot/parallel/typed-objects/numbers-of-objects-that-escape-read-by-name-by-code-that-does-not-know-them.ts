// The fields are numbers by their type and the objects go where nobody follows them. Code that knows nothing of the objects asks them by name, stores by name and asks whether the name is there.
// Whatever can be in a number comes back as it was stored. Objects of a second shape go the same way and are also read by code that knows them, and those of the classes are filled by their constructors:
// every reader sees the same. The numbers of a third shape are named by no code at all: they are listed, copied, written out, asked for through Reflect and under names put together at run time.
type Row = { cost: number; share?: number; note: string };
type Known = { price: number; part: number; label: string };
type Listed = { width: number; depth: number };
type Asked = { first: number; second: number };
class Priced {
  constructor(
    public cost: number,
    public rank: number,
  ) {}
}
class Discounted extends Priced {
  constructor(
    cost: number,
    rank: number,
    public off: number,
  ) {
    super(cost, rank);
  }
}
const values = [
  0,
  -0,
  1,
  -1,
  2147483647,
  2147483648,
  -2147483649,
  9007199254740992,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  5e-324,
  1.7976931348623157e308,
];
const store = globalThis as any;
const under = (name: string) => (process.argv.length > 99 ? process.argv[9] : name);
store[under("rows")] = values.map(
  (value, index): Row => (index % 3 ? { cost: value, share: value / 2, note: "" } : { cost: value, note: "" }),
);
store[under("priced")] = values.map((value, index) =>
  index % 2 ? new Discounted(value, index, value) : new Priced(value, index),
);
const known: Known[] = values.map(value => ({ price: value, part: value, label: "known" }));
store[under("known")] = known;
store[under("listed")] = values.map((value, index): Listed => ({ width: value, depth: index + 0.5 }));

store[under("asked")] = values.map((value, index): Asked => ({ first: value, second: index + 0.25 }));
const seen = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
const lines: string[] = [];
const all = (list: any[], read: (item: any) => unknown) => list.map(item => seen(read(item))).join(" ");
lines.push("cost: " + all(store.rows, row => row.cost));
lines.push("share: " + all(store.rows, row => row.share));
lines.push("has share: " + all(store.rows, row => "share" in row));
lines.push("sum: " + seen(store.rows.slice(0, 5).reduce((sum: number, row: any) => sum + row.cost, 0)));
lines.push("added to: " + all(store.rows, row => row.cost + 1));
lines.push("bits: " + all(store.rows, row => row.cost | 0));
lines.push("same as itself: " + all(store.rows, row => row.cost === row.cost));
lines.push("kind: " + all(store.rows, row => typeof row.cost));
lines.push("of classes: " + all(store.priced, item => item.cost + "/" + item.rank + "/" + seen(item.off)));

let sumOfKnown = 0;
for (const row of known)
  if (row.price === row.price && row.price < 100 && row.price > -100) sumOfKnown += row.price + row.part;
lines.push(
  "known, by code that knows: " +
    seen(sumOfKnown) +
    " | by code that does not: " +
    all(store.known, row => row.price) +
    " | " +
    all(store.known, row => row.part),
);

for (const row of store.rows) row.cost = row.cost * 2;
lines.push("doubled: " + all(store.rows, row => row.cost));
store.rows[1].cost = -0;
store.rows[2].cost = 0.1 + 0.2;
store.rows[3].cost = 7;
lines.push("stored: " + all(store.rows.slice(1, 4), row => row.cost));
store.rows[4].cost = "text";
store.rows[5].cost = { object: true };
store.rows[6].cost = undefined;
store.rows[7].cost = null;
store.rows[8].cost = 10n;
lines.push("other kinds: " + all(store.rows.slice(4, 10), row => typeof row.cost) + " | " + seen(store.rows[9].cost));
store.rows[4].cost = 4.5;
lines.push("a number again: " + seen(store.rows[4].cost) + " " + typeof store.rows[4].cost);
delete store.rows[10].cost;
lines.push(
  "deleted: " + seen(store.rows[10].cost) + " " + ("cost" in store.rows[10]) + " " + Object.keys(store.rows[10]).join(),
);
store.rows[10].cost = 2.25;
lines.push("there again: " + seen(store.rows[10].cost) + " " + Object.keys(store.rows[10]).join());
Object.defineProperty(store.rows[11], "cost", { get: () => 42, configurable: true });
lines.push("a getter: " + seen(store.rows[11].cost));
Object.freeze(store.rows[12]);
lines.push("frozen: " + Reflect.set(store.rows[12], "cost", 7) + " " + seen(store.rows[12].cost));
lines.push(
  "json: " +
    JSON.stringify(store.rows[13]) +
    " " +
    JSON.stringify(store.priced[9]) +
    " " +
    JSON.stringify(store.rows[0]),
);
lines.push(
  "entries: " +
    Object.entries(store.priced[1])
      .map(([key, value]) => key + "=" + seen(value))
      .join(),
);
lines.push(
  "copy: " +
    seen({ ...store.priced[1] }.cost) +
    " " +
    seen(Object.assign({}, store.priced[9]).off) +
    " " +
    seen(structuredClone(store.rows[13]).cost),
);
const { cost, ...rest } = store.priced[3];
lines.push("taken apart: " + seen(cost) + " " + JSON.stringify(rest));
let asked = 0;
for (const item of store.asked) if ("second" in item && "first" in item && !("third" in item)) asked++;
lines.push("asked: " + asked + " " + JSON.stringify(store.asked));
const name = (...parts: string[]) => parts.join("");
lines.push(
  "listed, has: " + all(store.listed, item => "width" in item && Object.hasOwn(item, "depth") && !("height" in item)),
);
lines.push(
  "listed, through Reflect: " +
    all(store.listed, item => Reflect.get(item, "width")) +
    " | " +
    all(store.listed, item => Reflect.get(item, "depth")),
);
lines.push("listed, under a name made at run time: " + all(store.listed, item => item[name("wi", "dth")]));
lines.push("listed, values: " + all(store.listed, item => Object.values(item).map(seen).join("/")));
lines.push("listed, json: " + JSON.stringify(store.listed));
lines.push(
  "listed, copies: " +
    all(store.listed, item =>
      Object.values({ ...item })
        .map(seen)
        .join("/"),
    ),
);
lines.push("listed, descriptors: " + all(store.listed, item => Object.getOwnPropertyDescriptor(item, "width")!.value));
for (const item of store.listed) Reflect.set(item, "width", Reflect.get(item, "width") / 2);
lines.push("listed, halved: " + all(store.listed, item => Reflect.get(item, "width")));
store.listed[1][name("wi", "dth")] = -0;
Reflect.set(store.listed[2], "width", "text");
Reflect.set(store.listed[3], "depth", { object: true });
Reflect.deleteProperty(store.listed[4], "width");
Object.defineProperty(store.listed[5], "depth", { get: () => 42, enumerable: true });
Object.freeze(store.listed[6]);
lines.push(
  "listed, altered: " +
    all(store.listed.slice(1, 7), item =>
      Object.entries(item)
        .map(([key, value]) => key + "=" + (typeof value === "object" ? "object" : seen(value)))
        .join("/"),
    ) +
    " | " +
    Reflect.set(store.listed[6], "width", 1),
);
Bun.gc(true);
lines.push(
  "listed, behind a collection: " +
    all(store.listed, item =>
      Object.values(item)
        .map(value => (typeof value === "object" ? "object" : seen(value)))
        .join("/"),
    ),
);
lines.push("behind a collection: " + all(store.priced, item => item.cost) + " | " + all(store.known, row => row.part));
console.log(lines.join("\n"));
