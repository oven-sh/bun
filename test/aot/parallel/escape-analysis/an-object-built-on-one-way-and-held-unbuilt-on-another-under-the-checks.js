// Flags: --aot-verify-each-pass
const values = [Symbol.for("s"), true, null, -0, undefined, "ab", {}, 1, 2n, 0.5, "", NaN, false, []];
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[" + value.map(describe).join() + "]";
  if (typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + describe(value[key])).join() + "}" + typeof value.valueOf();
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
}
function go7(y, z, turns) {
  let a = y, b = Object(y), c = { v: y };
  let rest = [];
  let said = "";
  let spins = 0;
  if (b !== b) { [c, a] = [a, c]; ({ p: a, q: b } = { p: b, q: a }); [b, ...rest] = [a, b, false]; a = rest[1]; }
  [a, b] = [b, a];
  a = y === z ? { v: true, w: a } : a;
  { const held = [a, b]; b = held[0]; a = held[1]; }
  return said + [a, b, c, rest.length].map(describe).join(" ");
}
{
  const lines = [];
  for (const value of values)
    for (const other of [null, true, value]) {
      try {
        lines.push(go7(value, other, lines.length % 3));
      } catch (error) {
        lines.push("threw " + error.name);
      }
    }
  console.log("go7", lines.join(" | "));
}
export {};
