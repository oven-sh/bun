// An async method waits twice, makes a literal on one way and null on the other, and hands that to a method of the same object, which hands it back, or what a table or a function has for it.
// What the program works on has been handed once to text that is evaluated at run time, and has come back.
const through = new Function("value", process.argv[9] ?? "return value");
class Finder {
  constructor(table) {
    this.options = { name: "main", table, renews: true };
    this.renewed = 0;
  }
  translate(item) {
    if (!item || !this.options.table) return item;
    const key = `${item.host}:${item.port}`;
    let result = item;
    if (typeof this.options.table === "function") {
      result = this.options.table(key) || item;
    } else if (typeof this.options.table === "object") {
      result = this.options.table[key] || item;
    }
    return result;
  }
  async renew(client) {
    if (!this.options.renews) return;
    const result = await client.ask("others", this.options.name);
    if (!Array.isArray(result)) return;
    this.renewed += result.length;
  }
  async find(client) {
    const result = await client.ask("address", this.options.name);
    await this.renew(client);
    return this.translate(Array.isArray(result) ? { host: result[0], port: Number(result[1]) } : null);
  }
}
const answers = {
  address: [["a.example", "7000"], null, ["b.example", "7001"], "no list"],
  others: [[1, 2], undefined, [3], []],
};
function clientOf(turn) {
  return { ask: async (what, name) => (name === "main" ? answers[what][turn & 3] : undefined) };
}
const tables = [
  undefined,
  { "a.example:7000": { host: "inside", port: 1 } },
  key => (key.startsWith("b.") ? { host: "made", port: key.length } : null),
  "neither",
];
const lines = [];
for (let turn = 0; turn < 64; turn++) {
  const finder = through(new (through(Finder))(through(tables[(turn >> 2) & 3])));
  const found = await finder.find(through(clientOf(turn)));
  if (turn < 16) lines.push(`${turn}: ${found === null ? "null" : found.host + ":" + found.port} ${finder.renewed}`);
}
console.log(lines.join("\n"));
