const lamps = { hall: "./wick.cjs" };
exports.lay = (name, path) => {
  lamps[name] = path;
};
const first = require(lamps.hall);
import("./wick.cjs").then(second => {
  const again = require(lamps.hall);
  console.log(globalThis.kinds.join(), Object.keys(first).length, Object.keys(second).length, again === first);
});
