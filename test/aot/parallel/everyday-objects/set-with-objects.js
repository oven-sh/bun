// Sets of objects and lists: what is the same and what only looks so
function unique(values) {
  const seen = new Set();
  const twice = [];
  for (const value of values) {
    if (seen.has(value)) twice.push(value.name);
    seen.add(value);
  }
  const copies = new Set([...seen].map(value => ({ ...value })));
  return seen.size + " " + twice.join() + " " + copies.has(values[0]) + " " + [...copies].map(copy => copy.name).join();
}
const a = { name: "a" }, b = { name: "b" };
console.log(unique([a, b, a]));
console.log(unique([b, b, b]));
console.log(unique([{ name: "a" }, a, { name: "a" }]));
