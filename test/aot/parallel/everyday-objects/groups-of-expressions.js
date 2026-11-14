// Groups of a match by number and by name, over several texts
function parse(text) {
  const match = /^(?<key>\w+)(?:\[(?<index>\d+)\])?=(?<value>.*)$/.exec(text);
  if (!match) return "no " + text.length;
  const { key, index = "none", value } = match.groups;
  let filled = 0;
  for (let i = 1; i < match.length; i++) if (match[i] !== undefined) filled += match[i].length;
  return [key, index, value, filled, match.length].join("/");
}
console.log(parse("a=1"), parse("list[2]=b c"));
console.log(parse("x[10]="));
console.log(parse("nothing"), parse("=5"));
