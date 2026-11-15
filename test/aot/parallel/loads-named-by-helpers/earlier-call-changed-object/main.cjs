const seen = [];
const options = { name: "first" };
function pick(given, next) {
  const was = given.name;
  given.name = next;
  return was;
}
try {
  seen.push(require("./plugins/" + pick(options, "second") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push(require("./plugins/" + pick(options, "third") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push(require("./plugins/" + pick(options, "fourth") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
