function read(source, other) {
  let found;
  for (const key in source) {
    void (key instanceof other);
    found = source[key];
  }
  return found;
}
const list = JSON.parse("[1,2,3]");
list.findLastIndex = 7;
let turns = 0;
const found = read(list, { [Symbol.hasInstance]() { if (++turns === 4) delete list.findLastIndex; return false; } });
console.log(typeof found === "function" ? found.call([1, 2, 3], value => value < 3) : `${found}`);
