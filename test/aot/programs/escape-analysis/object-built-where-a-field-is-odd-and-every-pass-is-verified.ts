// One of two literals lacks a field that is a slice; the object is built where the name is empty.
type Split = { name: string; place?: string };
function split(source: string): Split {
  const at = source.lastIndexOf("@");
  if (at < 0) {
    return { name: source };
  }
  return { name: source.slice(0, at), place: source.slice(at + 1) };
}
const kept: Split[] = [];
// Too large to be inlined.
function keep(parts: Split): void {
  try {
    for (let i = 0; i < 2; i++) if (kept.length < 40 + i) kept.push(parts);
  } catch {
    kept.length = 0;
  }
}
const ids = ["plain", "a@north", "", "@", "a@", "a@b@c", "longer-without-a-mark", "x@y"];

function use(id: string, turn: number): number {
  const parts = split(id);
  if (parts.name === "" || parts.name === "plain") keep(parts);
  return parts.name.length + (turn & 1);
}
let total = 0;
for (let turn = 0; turn < 3000; turn++) for (const id of ids) total += use(id, turn);
console.log(total, kept.length);
for (const parts of kept.slice(0, 24)) console.log(JSON.stringify(parts), "place" in parts);

