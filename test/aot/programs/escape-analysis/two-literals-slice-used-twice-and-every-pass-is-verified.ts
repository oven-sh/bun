// Two literals; the second holds the same slice in two fields; the object is built behind the join.
type Split = { name: string; place?: string; size?: number; again?: string };
function split(source: string): Split {
  const at = source.lastIndexOf("@");
  if (at < 0) {
    return { name: source };
  }
  const place = source.slice(at + 1);
  return { name: source.slice(0, at), place, again: place };
}
const kept: Split[] = [];
// Too large to be inlined.
function keep(parts: Split): void {
  try {
    for (let i = 0; i < 2; i++) if (kept.length < 60 + i) kept.push(parts);
  } catch {
    kept.length = 0;
  }
}
const ids = ["plain", "a@north", "", "@", "a@", "a@b@c", "longer-without-a-mark", "x@y", "@south", "plain"];

function use(id: string, turn: number): number {
  const parts = split(id);
  if (parts.name === "" || parts.name === "plain" || parts.name === "x") keep(parts);
  return parts.name.length + (turn & 1);
}
let total = 0;
for (let turn = 0; turn < 3000; turn++) for (const id of ids) total += use(id, turn);
console.log(total, kept.length);
for (const parts of kept.slice(0, 30)) console.log(JSON.stringify(parts), "place" in parts, "size" in parts);

