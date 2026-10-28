function show(list) {
  const parts = [];
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    parts.push(index in list ? (Object.is(item, -0) ? "-0" : String(item)) : "hole");
  }
  return `${list.length}[${parts.join(",")}] ${Object.keys(list).join("")}`;
}
function pair(a, b) {
  return [a, b * 2];
}
function triple(a, b, c) {
  return [a, b, c];
}
function nine(a, b) {
  return [a, b, a, b, a, b, a, b, a];
}
function withHole(a, b) {
  return [a, , b];
}
function grown(a, b) {
  const list = [a, b];
  list.push(a);
  list.push("text");
  return list;
}
const lines = [];
const numbers = [0, 1, -1, 1.5, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 4294967296, 5e-324];
for (const a of numbers) {
  for (const b of [2, 0.25, NaN]) {
    lines.push("pair " + show(pair(a, b)) + " triple " + show(triple(a, b, a)) + " nine " + show(nine(a, b)) + " hole " + show(withHole(a, b)) + " grown " + show(grown(a, b)));
  }
}
for (const a of numbers) {
  lines.push("short " + show(pair(a)) + " " + show(pair(undefined, a)) + " " + show(triple(a)) + " " + show(triple(undefined, a)) + " " + show(triple(undefined, undefined, a)) + " " + show(triple()));
  lines.push("short " + show(nine(a)) + " " + show(nine(undefined, a)) + " " + show(withHole(a)) + " " + show(withHole(undefined, a)) + " " + show(grown(a)) + " " + show(grown(undefined, a)));
}
const pairs = Array.from({ length: 40 }, (_, k) => [k, k * 2]);
let sum = 0;
for (let turn = 0; turn < 50; turn++) for (const [a, b] of pairs) sum += a + b;
lines.push("sum " + sum + " " + show(pairs[39]) + " " + JSON.stringify(pairs[7]));
const sparse = Array.from({ length: 6 }, (_, k) => [k % 3 ? k : undefined, k / 2]);
lines.push("sparse " + sparse.map(show).join(" ") + " " + JSON.stringify(sparse));
for (const list of sparse) {
  list[0] = (list[0] ?? 0.5) + 1;
  list[1] += 1;
}
lines.push("stored " + sparse.map(show).join(" "));
console.log(lines.join("\n"));
