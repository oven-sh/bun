function horner(c, x) {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i];
  return c.concat ? typeof s + " " + s : "none " + s;
}
function listLike() {
  return arguments;
}
const own = [1, 2, 3];
own.concat = 0;
const hidden = [4, 5];
Object.defineProperty(hidden, "concat", {
  get() {
    hidden.push(6);
    return hidden.length & 1;
  },
});
const said = [];
for (const c of [[1, 2.5, 3], "123", new Float64Array([1.5, 2]), { length: 2, 0: 7, 1: 8 }, { length: 2, 0: 7, 1: 8, concat: true }, listLike(1, 2), own, hidden, hidden, [], ["a", 1], [, 2]])
  for (let x = 1; x < 3; x++) said.push(horner(c, x));
console.log(said.join("\n"));
