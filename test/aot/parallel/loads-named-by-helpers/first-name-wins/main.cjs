const seen = [];
let chosen;
function pick(name) {
  if (!chosen) chosen = name;
  return chosen;
}
try {
  seen.push(require("./plugins/" + pick("first") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push(require("./plugins/" + pick("second") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push(require("./plugins/" + pick("third") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
