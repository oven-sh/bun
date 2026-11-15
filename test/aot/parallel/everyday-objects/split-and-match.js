// split by expressions with groups, match with and without g, matchAll
function cut(text) {
  const parts = text.split(/\s*([,;])\s*/);
  const all = text.match(/[a-z]+/g);
  const one = text.match(/([a-z])([a-z])?/);
  const each = [...text.matchAll(/(?<letter>[a-z])(\d)?/g)].map(m => m.groups.letter + (m[2] ?? "-") + m.index);
  return [parts.length, parts.join("|"), all && all.join("+"), one && one.slice(1).join("/"), each.join()].join(" ");
}
console.log(cut("a1, bc ;d2"));
console.log(cut("xyz"));
console.log(cut(""));
