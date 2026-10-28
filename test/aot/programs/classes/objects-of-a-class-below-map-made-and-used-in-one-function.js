// The object is made and used in one function, so that the compiler knows its class without a test.
const lines = [];
class Defaults extends Map { getOr(key, fallback) { return this.get(key) ?? fallback; } }
function fresh(kind) {
  const d = new Defaults([["a", 1]]);
  if (kind === 1) d.get = () => 42;
  if (kind === 2) d.getOr = () => "own";
  if (kind === 3) Object.setPrototypeOf(d, { getOr() { return "relinked"; } });
  if (kind === 4) Object.defineProperty(d, "get", { get() { return () => "getter"; } });
  if (kind === 5) d.extra = 1;
  if (kind === 6) Object.freeze(d);
  return d.getOr("a", 9) + "," + d.getOr("b", 9);
}
for (let round = 0; round < 3; round++) for (let kind = 0; kind < 7; kind++) lines.push(fresh(kind));
let sum = 0; for (let i = 0; i < 700; i++) sum += fresh(i % 7).length; lines.push(sum);
console.log(lines.join(" "));
