const seen = [];
const pick = name => name;
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
