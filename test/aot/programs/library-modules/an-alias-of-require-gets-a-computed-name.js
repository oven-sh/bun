// `require` is copied into a constant, passed to a function, and called through (0, require) and .call. Each follows the rules of require(name), and none brings a library module in.
import "node:path";

const copy = require;
function through(load, name) {
  return load(name);
}
const ways = {
  copy: name => copy(name),
  argument: name => through(require, name),
  comma: name => (0, require)(name),
  call: name => require.call(null, name),
};
for (const name of process.env.NAMES.split(",")) {
  for (const way in ways) {
    try {
      console.log(name, way, typeof ways[way](name));
    } catch (error) {
      console.log(name, way, error.code);
    }
  }
}
console.log("went on");
