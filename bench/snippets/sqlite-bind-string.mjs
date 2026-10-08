// @runtime bun
import { Database } from "bun:sqlite";
import { bench, run } from "../runner.mjs";

// The cost of a string parameter, by how JavaScriptCore stores the string and by its length in UTF-16 code units.
const db = new Database(":memory:");
db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT)");
const select = db.prepare("SELECT ? AS s");
const store = db.prepare("INSERT OR REPLACE INTO t (id, s) VALUES (1, ?)");

const fill = (unit, length) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const kinds = {
  "8-bit ASCII": length => fill("abcdefghij", length),
  "8-bit Latin-1": length => fill("caf\u00e9 na\u00efve ", length),
  "16-bit, mostly ASCII": length => fill("id 42: \u65e5\u672c \u00e9 ", length),
  "16-bit CJK": length => fill("\u65e5\u672c\u8a9e\u30c6\u30ad\u30b9\u30c8", length),
  "16-bit emoji": length => fill("\u{1F600}\u{1F680}", length + (length % 2)),
  "16-bit, one unpaired surrogate": length => fill("abcdefghij", length - 1) + "\ud800",
};

for (const [kind, make] of Object.entries(kinds)) {
  for (const length of [8, 40, 400, 4096, 100_000]) {
    const string = make(length);
    bench(`SELECT ?: ${kind}, ${length} units`, () => select.get(string));
    bench(`INSERT: ${kind}, ${length} units`, () => store.run(string));
  }
}

await run();
