// Object.assign() creates fields in the order of its sources' keys, whatever order another literal with the same names has.
function scene() {
  const o = Object.assign({ g: 5 }, { f: 1.5 });
  const other = { f: "first", g: 4 };
  let keys;
  for (let i = 0; i < 3; i++) keys = Object.keys(o);
  return [other.f, keys.join()].join(" ");
}
console.log(scene());
