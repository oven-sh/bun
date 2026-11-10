const seen = [];
const held = {};
function pick(name, keep) {
  if (keep) held.get = () => name;
  return held.get();
}
seen.push(pick("first", true));
try {
  seen.push(require("./plugins/" + pick("second", false) + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push(require("./plugins/" + pick("third", false) + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
