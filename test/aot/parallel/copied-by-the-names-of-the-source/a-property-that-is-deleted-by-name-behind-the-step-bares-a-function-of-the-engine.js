function read(source) {
  let found;
  for (const key in source) {
    if (key.length > 5) delete source.findLastIndex;
    found = source[key];
  }
  return found;
}
const list = JSON.parse("[1,2,3]");
list.findLastIndex = 1;
const found = read(list);
console.log(typeof found === "function" ? found.call([1, 2, 3], value => value < 3) : `${found}`);
