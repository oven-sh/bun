const seen = [];
let last = "first";
function pick(name) {
  const was = last;
  last = name;
  return was;
}
try {
  seen.push((await import("./plugins/" + pick("second") + ".mjs")).one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push((await import("./plugins/" + pick("third") + ".mjs")).one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
try {
  seen.push((await import("./plugins/" + pick("fourth") + ".mjs")).one);
} catch (error) {
  seen.push("threw " + error.constructor.name);
}
console.log(seen.join(" "));
