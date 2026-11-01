// Flags: --aot-heat=ReadOffStructure
// As classes.ts, under the model that a part of a program gets which is built by itself: how often its functions run is read off the text alone.
// Everyday code: closures, destructuring and defaults, spread and rest, maps and sets, regular expressions, switch, labels, optional chains, getters of literals, sorting and JSON.
type Order = {
  id: number;
  customer?: { name: string; address?: { city?: string } };
  items: { sku: string; price: number; count?: number }[];
  note?: string | null;
};
const orders: Order[] = [
  {
    id: 1,
    customer: { name: "Ada", address: { city: "London" } },
    items: [
      { sku: "a-1", price: 2.5, count: 4 },
      { sku: "b-2", price: 10 },
    ],
  },
  { id: 2, customer: { name: "Grace" }, items: [{ sku: "a-1", price: 2.5 }], note: null },
  { id: 3, items: [], note: "empty" },
  {
    id: 4,
    customer: { name: "Alan", address: {} },
    items: [
      { sku: "c-3", price: 0.1, count: 3 },
      { sku: "a-1", price: 2.5, count: 2 },
      { sku: "b-2", price: 10, count: 0 },
    ],
  },
];
function totals(list: Order[]) {
  const bySku = new Map<string, number>();
  const cities = new Set<string>();
  const lines: string[] = [];
  for (const { id, customer: { name = "nobody", address } = { name: undefined }, items, note = "no note" } of list) {
    let total = 0;
    for (const { sku, price, count = 1 } of items) {
      total += price * count;
      bySku.set(sku, (bySku.get(sku) ?? 0) + count);
    }
    cities.add(address?.city ?? "unknown");
    lines.push(`${id} ${name} ${total.toFixed(2)} ${note}`);
  }
  console.log(lines.join("\n"));
  console.log(
    [...bySku]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sku, count]) => sku + "=" + count)
      .join(),
    [...cities].join(),
  );
}
function texts() {
  const text = "2026-10-31 error: disk 93% full; 2026-11-01 warn: disk 85% full; no date here";
  const found = [...text.matchAll(/(?<year>\d{4})-(?<month>\d\d)-(?<day>\d\d) (?<level>\w+): disk (\d+)%/g)];
  console.log(
    found.map(match => `${match.groups!.level}@${match.groups!.day}.${match.groups!.month}:${match[5]}`).join(),
  );
  console.log(
    text.replace(/(\d+)%/g, (_, n) => 100 - Number(n) + "% free").slice(0, 40),
    text.split(/;\s*/).length,
    /^\d/.test(text),
  );
  const sticky = /\d+/y;
  sticky.lastIndex = 5;
  console.log(sticky.exec(text)?.[0], sticky.lastIndex, sticky.exec(text), sticky.lastIndex);
  console.log(
    "ß".toUpperCase(),
    "İ".toLowerCase().length,
    "á".normalize("NFC").length,
    [..."a😀b"].length,
    "abc".at(-1),
    "x".padStart(3, "ab"),
  );
}
function control(values: unknown[]) {
  const kinds: string[] = [];
  outer: for (const value of values) {
    switch (typeof value) {
      case "number":
        if (Number.isNaN(value)) continue outer;
        kinds.push(value < 0 ? "negative" : "number");
      // falls through
      case "bigint":
        kinds.push("numeric");
        break;
      case "object":
        if (value === null) break outer;
        kinds.push(Array.isArray(value) ? "list of " + value.length : "object");
        break;
      default:
        kinds.push(typeof value);
    }
  }
  console.log(kinds.join());
}
function closures() {
  const makers = [1, 2, 3].map(n => {
    let calls = 0;
    return (...more: number[]) => ++calls * n + more.reduce((sum, one) => sum + one, 0);
  });
  console.log(makers.map(f => f()).join(), makers.map(f => f(1, 2)).join(), makers[2](...[1, 1], ...[]));
  const literal = {
    parts: ["a", "b"],
    get joined() {
      return this.parts.join("+");
    },
    set joined(value: string) {
      this.parts = value.split("+");
    },
    ["computed" + 1]: true,
    toJSON() {
      return { ...this, toJSON: undefined, extra: this.joined };
    },
  };
  literal.joined = "x+y+z";
  console.log(
    JSON.stringify(literal),
    JSON.stringify({ a: [undefined, () => 1, Symbol("s")], b: undefined, c: new Date(0), d: 1n < 2 }, null, 1).replace(
      /\s+/g,
      " ",
    ),
  );
  const {
    parts: [head, ...rest],
    ...others
  } = literal;
  console.log(head, rest.join(), Object.keys(others).join());
}
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
totals(orders);
texts();
control([1, -1, NaN, 2n, "s", [1, 2], {}, undefined, true, null, "never reached"]);
closures();
totals(orders);
texts();
control([1, -1, NaN, 2n, "s", [1, 2], {}, undefined, true, null, "never reached"]);
closures();
