const table = new Map<string, number>([["a", 1], ["b", 2]]);
const entries = table.size;
const members = new Set<string>(["x", "y", "z"]);
const howMany = members.size;
const hasA = table.has("a");
const grown = new Map<string, number>([["k", 1]]);
const before = grown.size;
grown.set("l", 2);
const after = grown.size;

function later(): void {
  console.log(entries, howMany, hasA, table.get("b"), members.has("y"), before, after, grown.size);
}
setTimeout(later, 1);
