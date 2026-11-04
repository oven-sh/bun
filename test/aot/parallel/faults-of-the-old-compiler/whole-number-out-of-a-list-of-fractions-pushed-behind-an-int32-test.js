// A whole number that comes out of a list of fractions is pushed onto a list of small integers behind (x | 0) === x.
function look(x) {
  const list = [1];
  if (typeof x === "number" && (x | 0) === x) list.push(x);
  return list[0] + list[list.length - 1];
}
const fr = [1.5, 4];
console.log(String(look(fr.with(0, "a")[1])));
