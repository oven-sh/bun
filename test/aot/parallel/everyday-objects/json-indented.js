// JSON with an indent and a list of keys, over records in records
function print(name, size) {
  const value = { name, size, inner: { size: size + 1, list: [size, { name }] }, skip: () => 1 };
  const all = JSON.stringify(value, null, 1);
  const some = JSON.stringify(value, ["size", "inner"], "-");
  return all.replace(/\n */g, "~") + " " + some.replace(/\n/g, "~") + " " + all.length;
}
console.log(print("a", 1));
console.log(print('q"', 20));
console.log(print("", -1));
