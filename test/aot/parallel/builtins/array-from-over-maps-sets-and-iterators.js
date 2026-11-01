// Array.from over maps, sets and their iterators: tables written in the program and tables filled at run time, with entries deleted, iterators half used, tables cleared and grown.
const out = [];
function say(name, value) { out.push(name + " " + JSON.stringify(value, (k, v) => (v === undefined ? "undefined" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
const written = new Map([["tea", 3], ["milk", 2], ["bread", 4], ["salt", 1]]);
const writtenSet = new Set(["x", "y", "z"]);
const numbers = new Set([3, 1, 4, 1, 5]);
function filled(n, make) { const m = new Map(); for (let k = 0; k < n; k++) m.set(make(k), k); return m; }
function all(m) { return [Array.from(m.keys()), Array.from(m.values()), Array.from(m.entries()), Array.from(m), [...m.keys()], [...m.values()]]; }
for (let round = 0; round < 120; round++) {
  out.length = 0;
  say("written", all(written)); say("written set", [Array.from(writtenSet), Array.from(writtenSet.values()), Array.from(writtenSet.keys()), Array.from(writtenSet.entries())]);
  say("numbers", Array.from(numbers));
  for (const n of [0, 1, 4, 5, 8, 9, 17, 300]) {
    const m = filled(n, k => "k" + k);
    const lists = all(m);
    say("filled " + n, n < 20 ? lists : lists.map(l => l.length + ":" + JSON.stringify(l[l.length - 1])));
  }
  const kinds = new Map([[1, 1.5], [2.5, "text"], ["s", undefined], [null, null], [undefined, -0], [-0, { a: 1 }], [NaN, [1]], [true, 10n], [2 ** 31, 2 ** 53]]);
  say("kinds", all(kinds));
  say("ints", Array.from(filled(6, k => k).values())); say("doubles", Array.from(new Map([[1, 0.5], [2, 1.5]]).values())); say("ints and doubles", Array.from(new Map([[1, 1], [2, 1.5], [3, 2]]).values()));
  const holes = filled(10, k => k); for (const k of [0, 1, 4, 9]) holes.delete(k);
  say("deleted", all(holes)); holes.set(4, "again"); say("added again", all(holes));
  for (let k = 0; k < 10; k++) holes.delete(k); say("all deleted", all(holes));
  const half = filled(6, k => "h" + k), it = half.values(); it.next(); it.next();
  say("half used", Array.from(it)); say("used up", [Array.from(it), it.next()]);
  const keysIt = half.keys(); keysIt.next(); half.delete("h1"); half.delete("h0"); half.set("late", 9);
  say("half used, then changed", Array.from(keysIt)); say("closed", keysIt.next());
  const grown = filled(3, k => k), standing = grown.values(); standing.next(); for (let k = 3; k < 40; k++) grown.set(k, k);
  say("grown behind an iterator", Array.from(standing).length);
  const cleared = filled(5, k => k), over = cleared.keys(); over.next(); cleared.clear(); cleared.set("new", 1);
  say("cleared behind an iterator", Array.from(over));
  const fresh = filled(4, k => k), list = Array.from(fresh.values()); list.push("mine"); fresh.set(9, 9);
  say("the list is its own", [list, Array.from(fresh.values())]);
  const changedWritten = new Map([["a", 1], ["b", 2]]); say("written, first", Array.from(changedWritten.values())); changedWritten.delete("a"); changedWritten.set("c", 3); say("written, changed", all(changedWritten));
  say("mapped", [Array.from(written.values(), v => v * 2), Array.from(numbers, (v, k) => v + k)]);
  say("of sets of objects", Array.from(new Set([{ a: 1 }, [2], "s", 3])).length);
  class Heir extends Array {} say("heir", [Heir.from(written.values()) instanceof Heir, Heir.from(numbers).length]);
}
console.log(out.join("\n"));
