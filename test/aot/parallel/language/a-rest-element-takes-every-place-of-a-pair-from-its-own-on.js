// `[...all]` over a pair takes the key and the value, and `[key, ...rest]` takes the value and then finds the end: the step of a rest element runs once for each place.
const lines = [];
const show = (name, ...values) => lines.push(name + ": " + values.map(value => typeof value + " " + String(value)).join(", "));

for (const [...all] of Object.entries({ a: 1, b: true })) show("Object.entries", all.length, all[0], all[1], all[0] + "=" + all[1]);
for (const [...all] of new Map([["x", 1]])) show("a map", all.length, all[0], all[1]);
for (const [...all] of new Map([["x", 1]]).entries()) show("entries of a map", all.length, all[1] + 1, all[0].length);
{
  const filled = new Map();
  filled.set("a", 1);
  for (const [...all] of filled.entries()) show("entries of a map that set() filled", all.length, all[1] + 1, all[0].length);
}
for (const [...all] of ["a", "b"].entries()) show("entries of a list", all.length, all[0] + 1, all[1].length);
for (const [...all] of new Set(["s"]).entries()) show("entries of a set", all.length, all[0], all[1]);
for (const [key, ...rest] of new Map([["x", 1]])) show("one place ahead of the rest", key, rest.length, rest[0], rest[1]);
for (const [key, value, ...rest] of Object.entries({ x: 1 })) show("both places ahead of the rest", key, value, rest.length, rest[0]);
{
  const [[...first]] = new Map([[{ id: 7 }, "value"]]);
  show("a pattern in a pattern", first.length, first[0].id, first[1].length);
}
{
  const [key, ...rest] = Object.entries({ name: "text" })[0];
  show("a pair out of a list of pairs", key.length, rest.length, rest[0].length);
}

function sum(map) {
  let total = 0;
  for (const [...all] of map) total += all[1];
  return total;
}
function join(object) {
  let text = "";
  for (const [...all] of Object.entries(object)) text += all[0] + "=" + all[1] + ";";
  return text;
}
function lengths([...all]) {
  return all.map(each => String(each).length).join(",");
}
show("in functions", sum(new Map([["a", 1], ["b", 2]])), join({ a: 1, b: true }), lengths(Object.entries({ long: 12345 })[0]));
console.log(lines.join("\n"));
