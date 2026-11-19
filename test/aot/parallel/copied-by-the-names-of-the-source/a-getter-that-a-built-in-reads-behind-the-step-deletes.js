function read(source) {
  let found;
  for (const key in source) {
    Reflect.get(source, "trap");
    found = source[key];
  }
  return found;
}
const list = JSON.parse("[1,2,3]");
list.flatMap = 1;
let turns = 0;
Object.defineProperty(list, "trap", {
  get() {
    if (++turns === 4) delete list.flatMap;
    return 1;
  },
  enumerable: false,
});
const found = read(list);
console.log(typeof found === "function" ? found.call([1, 2], value => [value, value]).join() : `${found}`);
