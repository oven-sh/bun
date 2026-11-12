const seen = [];
const box = {};
function pick(name, keep) {
  if (keep) box.make = () => name;
  return ["x"].map(box.make)[0];
}
pick("first", true);
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
try {
  seen.push(require("./plugins/" + pick("fourth", true) + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
