function sum(file) {
  let total = 0;
  for (let index = 0; index < 1000; index++) total += file.first + file.box.value;
  return total;
}
function read() {
  return require("./file.cjs");
}
setTimeout(() => {
  const file = read();
  const { first, second, count } = require("./file.cjs");
  console.log(Object.prototype.toString.call(file), Object.keys(file).join(), first, second, count(), sum(file));
  console.log(file === read(), typeof file.default, Object.keys(file.default).join(), file.second, "second" in file, "first" in file);
  const name = "./file" + (globalThis.never ? "s" : "") + ".cjs";
  console.log("by a computed name", require(name) === file);
  file.first = 5;
  console.log(file.first, Object.isFrozen(file), Reflect.set(file, "first", 6));
  console.log(file.__esModule, "__esModule" in file, Reflect.ownKeys(file).map(String).join(), JSON.stringify(Object.getOwnPropertyDescriptor(file, "__esModule")));
  file.default.first = 7;
  console.log(file.first, file.default.first, sum(file.default), sum(file));
  for (const key in file) console.log(key, typeof file[key]);
  import("./file.cjs").then(names => console.log("import() finds the same object", names === file));
}, 1);
