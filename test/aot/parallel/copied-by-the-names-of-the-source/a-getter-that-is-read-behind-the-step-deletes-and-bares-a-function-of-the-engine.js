function read(source) {
  let found;
  for (const key in source) {
    if (key === "flatMap") void source.trap;
    found = source[key];
  }
  return found;
}
const list = JSON.parse("[1]");
Object.defineProperty(list, "trap", { get() { delete list.flatMap; return 1; }, enumerable: false, configurable: true });
list.flatMap = 1;
const found = read(list);
console.log(typeof found === "function" ? found.call([1, 2], value => [value, value]).join() : `${found}`);
