// Set.has and Map.has under substrings that are kept and asked again: of 8-bit and 16-bit texts, short and long, at the ends of a text, in written tables, in small and large ones, beside numbers and objects, behind deletions.
const lines = [];
const narrow = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega a bb ccc";
const wide = narrow.replace("gamma", "gämm中").replace("tau", "t€");
const long = "x".repeat(40) + " " + "y".repeat(48) + " " + "z".repeat(49) + " end";
function pieces(text) {
  const out = [];
  let from = 0;
  for (let at = 0; at <= text.length; at++) {
    if (at === text.length || text[at] === " ") {
      out.push(text.slice(from, at));
      from = at + 1;
    }
  }
  return out;
}
const lists = [pieces(narrow), pieces(wide), pieces(long), pieces("ab " + narrow.slice(3, 60) + " abc")];
const written = new Set(["alpha", "gamma", "omega", "t€", "bb", "end", "abc", "gämm中"]);
const writtenMap = new Map([["beta", 1], ["psi", 2], ["ccc", 3]]);
const small = new Set(), large = new Map(), mixed = new Set([1, "pi", null, 2.5, {}]);
for (const word of ["rho", "nu", "xi"]) small.add(word);
for (let i = 0; i < 400; i++) large.set(i % 3 ? "key" + i : narrow.slice(i % 60, (i % 60) + 5), i);
for (const word of narrow.split(" ").slice(0, 12)) large.set(word, word.length);
const tables = { written, writtenMap, small, large, mixed, none: new Set() };
function count(table, words) {
  let n = 0;
  for (const word of words) if (table.has(word)) n++;
  return n;
}
for (let round = 0; round < 5; round++) {
  for (const name in tables) lines.push(name + " " + lists.map((words) => count(tables[name], words)).join(" "));
  if (round === 1) {
    small.add("phi");
    large.delete("beta");
    written.delete("alpha");
    mixed.add("chi");
  }
  if (round === 2) {
    written.add("kappa");
    mixed.add(7).add(8).add(9).add(10).add("mu");
    small.clear();
  }
  if (round === 3) {
    for (const word of lists[0]) small.add(word);
    writtenMap.set("z".repeat(49), 1);
  }
}
const text = narrow.repeat(3);
let total = 0;
for (let at = 0; at < 300; at++) {
  const word = text.slice(at, at + 4);
  for (let again = 0; again < 3; again++) if (large.has(word) || written.has(word)) total += at;
}
lines.push(String(total), lists[0].join("|").length + lists[1].join("|"));
console.log(lines.join("\n"));
