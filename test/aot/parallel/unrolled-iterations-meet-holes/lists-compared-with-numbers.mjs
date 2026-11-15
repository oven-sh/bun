// A list of lists is compared with a number in a loop of four iterations that pushes: in the version over doubles the element is always undefined and has no value.
let seen = 0;
const keep = [];
function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + (Array.isArray(value) ? value : Object.entries(value)).map(show).join() + "]" : String(value);
}
function isWanted(value, at) {
  return value !== undefined && at > 1;
}
function find0(c, count) {
  let total = 0;
  const out = [];
  for (let i = count - 1; i > 0; i--) {
    for (let j = 3; j >= 0; j--) {
      if (c[count - 1 - i] < 2) out.push(() => i);
    }
  }
  return [total, out.map(one => (typeof one === "function" ? one() : one))];
}
try {
  for (let round = 0; round < 3; round++) console.log(show(find0([[2], [3, 0, 0], []], 4)));
} catch (error) {
  console.log("threw", (error).name);
}
console.log(seen, show(keep));
