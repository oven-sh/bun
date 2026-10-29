// Literals matched against subjects that are ropes: concatenations and pieces of other strings, of 8 and of 16 bits, that match and that do not; with the flags g and y, whose lastIndex counts;
// with groups; and what RegExp keeps of the last match.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
const invalid = /[^\t\x20-\x7e\x80-\xff]/, token = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/, pair = /(\w+)=(\w*)/, every = /a+/g, sticky = /b+/y, named = /(?<key>[a-z]+):(?<value>\d+)/, wide = /[α-ω]+/u;
const heads: string[] = hide(["text/", "key", "aa", "bbb", "x\u0001", "αβ", "", "name:"]), tails: string[] = hide(["plain; charset=utf-8", "=value", "baab", "bcb", "y", "γδ z", "", "42 more"]);
const long: string = hide("0123456789 key=value aaa bbb name:7 αβγ and a long tail so that a piece of it stays a piece");
function show(value: unknown): string { return value === null ? "null" : JSON.stringify(value); }
function all(subject: () => string, label: string) {
  const row: string[] = [];
  row.push(show(invalid.exec(subject()) !== null), show(invalid.test(subject())), show(token.test(subject())), show(token.exec(subject())));
  const m = pair.exec(subject()); row.push(show(m && [m.index, m.input.length, ...m]), show(RegExp.$1), show(RegExp.lastMatch));
  every.lastIndex = 0; row.push(show(every.exec(subject())), String(every.lastIndex), show(every.exec(subject())), String(every.lastIndex), show(every.test(subject())), String(every.lastIndex));
  sticky.lastIndex = 0; row.push(show(sticky.test(subject())), String(sticky.lastIndex), show(sticky.exec(subject())), String(sticky.lastIndex));
  sticky.lastIndex = 2; row.push(show(sticky.exec(subject())), String(sticky.lastIndex));
  const n = named.exec(subject()); row.push(show(n && n.groups && [n.groups.key, n.groups.value]), show(wide.exec(subject())), show(wide.test(subject())));
  row.push(String(subject().search(pair)), show(subject().match(pair)), show(subject().match(every)));
  lines.push(label + ": " + row.join(" "));
}
for (let i = 0; i < heads.length; i++)
  for (let j = 0; j < tails.length; j++) all(() => heads[i]! + tails[j]!, "joined " + i + " " + j);
for (let from = 0; from < 60; from += 7) all(() => long.slice(from, from + 30), "piece " + from);
for (let i = 0; i < heads.length; i++) all(() => heads[i]! + long.slice(8, 40) + tails[i]!, "three " + i);

let count = 0;
const which = Number(process.argv[2] ?? -1), rounds = Number(process.argv[3] ?? 0);
const type: string = hide("text/html"), charset: string = hide("; charset=utf-8");
for (let i = 0; i < rounds; i++) {
  switch (which) {
  case 0: if (invalid.exec(type + charset) !== null) count++; break;
  case 1: if (invalid.test(type + charset)) count++; break;
  case 2: if (token.test(type + charset)) count++; break;
  case 3: { const m = pair.exec(type + charset); if (m) count += m[1]!.length; break; }
  case 4: if ((type + charset).length) count++; break;
  case 5: if (invalid.test(long.slice(3, 40))) count++; break;
  }
}
lines.push("count " + count);
console.log(lines.join("\n"));
