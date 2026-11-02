// Object.assign() creates fields in the order of its sources' keys, whatever order another literal with the same names has.
function scene() {
  const o = Object.assign({}, { g: 5 }, { f: 1.5 });
  const other = { f: "first", g: 4 };
  let listed;
  for (let i = 0; i < 3; i++) listed = Object.keys(o).join();
  return [other.f, listed].join(" ");
}
console.log(scene());
