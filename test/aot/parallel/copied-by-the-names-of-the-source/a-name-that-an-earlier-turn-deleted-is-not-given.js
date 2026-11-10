function read(source) {
  let found;
  for (const key in source) {
    found = source[key];
    delete source.findLastIndex;
  }
  return found;
}
const list = JSON.parse("[1,2,3]");
list.findLastIndex = 1;
const found = read(list);
console.log(typeof found === "function" ? found.call([1, 2, 3], value => value < 3) : `${found}`);
