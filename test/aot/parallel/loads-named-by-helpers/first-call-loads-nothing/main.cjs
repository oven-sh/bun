const seen = [];
let chosen;
function pick(name) {
  if (!chosen) chosen = name;
  return chosen;
}
seen.push(pick("first"));
try {
  seen.push(require("./plugins/" + pick("second") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
