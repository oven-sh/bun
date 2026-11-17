function lazy() {
  return require("./lib");
}
function dive(n) {
  try {
    return dive(n + 1);
  } catch (e) {
    return lazy();
  }
}
let first;
try {
  first = dive(0);
} catch (e) {
  first = "threw " + e.name;
}
let k;
try {
  k = lazy();
} catch (e) {
  k = "threw " + e.name;
}
console.log(typeof k, k && typeof k === "object" ? Object.keys(k).join() : String(k));
let again;
try {
  again = lazy();
} catch (e) {
  again = "threw " + e.name;
}
console.log(again === k, typeof again);
