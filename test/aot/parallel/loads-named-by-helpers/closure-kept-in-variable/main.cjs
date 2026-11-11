const seen = [];
let get = () => "first";
function pick(name) {
  const was = get();
  get = () => name;
  return was;
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
try {
  seen.push(require("./plugins/" + pick("fourth") + ".cjs").one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
