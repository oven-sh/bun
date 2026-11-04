// A loop makes generators of a known generator function whose `prototype` is replaced between two turns: each generator has the prototype that the function had when it was made.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const replaced = Object.create(Object.getPrototypeOf(count.prototype), { mark: { value: "replaced" } });
function deed(n: number) {
  const made: Generator<number>[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 2) (count as any).prototype = replaced;
    made.push(count(i));
  }
  return made;
}
const made = deed(4);
for (const g of made) console.log(String((g as any).mark), String(Object.getPrototypeOf(g) === replaced), [...g].join());
console.log(String(made[0] === made[1]));
