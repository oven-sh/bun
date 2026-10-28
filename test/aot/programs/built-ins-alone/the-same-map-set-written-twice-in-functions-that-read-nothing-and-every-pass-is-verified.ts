// `map.set(key, value)` written twice in a row in functions that read no variable and no field: with keys that are NaN, zeros of both signs, a new object, a parameter.
function oddKeys(table: Map<unknown, unknown>) {
  table.set(NaN, 1);
  table.set(NaN, 1);
  table.set(-0, 2);
  table.set(0, 2);
  table.set(-0, 2);
  const o = {};
  table.set(o, o);
  table.set(o, o);
}
function given(table: Map<string, number>, key: string) {
  table.set(key, 1);
  table.set(key, 1);
  return table.set(key, 2).set(key, 2) === table;
}
const odd = new Map<unknown, unknown>();
oddKeys(odd);
console.log(
  odd.size,
  [...odd.keys()].map(k => (Object.is(k, -0) ? "-0" : typeof k === "object" ? "object" : String(k))).join(),
);
const counts = new Map<string, number>();
console.log(given(counts, "a"), given(counts, "b"), [...counts].join(";"));
