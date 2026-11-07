// Object.assign() creates fields in the order of its sources' keys, whatever order another literal with the same names has.
function scene(flag) {
  const source = flag ? { f: 1, h: 2 } : { h: 2, f: 1 };
  const o = Object.assign({ g: 5 }, source);
  const other = { f: "first", g: 4, h: 0 };
  let keys;
  for (let i = 0; i < 3; i++) keys = Object.keys(o);
  return [other.f, keys.join()].join(" ");
}
console.log(scene(true), scene(false));
