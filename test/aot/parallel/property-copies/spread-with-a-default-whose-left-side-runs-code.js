// `{ a, ...(given() ?? { b }) }` and `{ a, ...(given() || { b }) }`: the left side is a call that is made once, behind `a` and in front of `b`, and what it gives is spread whatever it is.
let log = "";
function note(name, v) {
  log += name;
  return v;
}
function nullish(v) {
  return { a: note("a", 1), ...(note("g", v) ?? { b: note("b", 2), c: note("c", 3) }), d: note("d", 4) };
}
function falsy(v) {
  return { a: note("a", 1), ...(note("g", v) || { b: note("b", 2), c: note("c", 3) }), d: note("d", 4) };
}
const values = [undefined, null, 0, "", false, NaN, "xy", 7, { b: "given", z: 1 }, { a: "over", d: "under" }, [5], () => 1];
for (let i = 0; i < values.length; i++) {
  log = "";
  console.log(i, JSON.stringify(nullish(values[i])), JSON.stringify(falsy(values[i])), log);
}
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(nullish(i % 2 ? undefined : { b: i })) + JSON.stringify(falsy(i % 3 ? 0 : { c: i }));
console.log(last);
