function read(source) {
  let found;
  for (const key in source) found = source[key];
  return found;
}
const proxy = new Proxy([1, 2, 3], {
  ownKeys: () => ["length", "findLast"],
  getOwnPropertyDescriptor: (target, key) => (key === "length" ? Reflect.getOwnPropertyDescriptor(target, key) : { value: 1, enumerable: true, configurable: true }),
});
const found = read([JSON.parse("{}"), proxy][1]);
console.log(typeof found === "function" ? found.call([1, 2, 3], value => value < 3) : `${found}`);
