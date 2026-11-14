const library = require("./library.cjs");
const minified = require("./minified.cjs");
for (const it of [library, minified]) {
  console.log(it.run(100), new it.Point(4).twice(), Object.keys(it).join(), it.run.name, Object.prototype.toString.call(it), it.__esModule);
  console.log(Object.entries(Object.getOwnPropertyDescriptors(it)).map(([name, d]) => name + d.enumerable + d.configurable + typeof d.get).join());
  let sum = 0;
  for (let i = 0; i < 300; i++) sum = sum + it.run(i % 7) | 0;
  console.log(sum);
}
