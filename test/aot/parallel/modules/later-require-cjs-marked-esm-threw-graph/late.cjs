setTimeout(() => {
  const file = require("./file.cjs");
  console.log(Object.prototype.toString.call(file), Reflect.ownKeys(file).map(String).join(), file.__esModule, typeof file.default, file.first, file.second);
  const { default: chosen } = file;
  console.log(typeof chosen === "function" ? chosen() : Object.keys(chosen).join());
}, 1);
