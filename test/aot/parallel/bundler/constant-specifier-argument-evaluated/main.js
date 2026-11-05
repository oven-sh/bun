const part = "a";
function name() {
  return part;
}
require("./" + part);
const whole = "./b";
function load() {
  return require(whole);
}
load();
let n = 0;
require((n++, "./c"));
console.log(name(), n);
try {
  loadLate();
} catch (e) {
  console.log(e.name);
}
const late = "./d";
function loadLate() {
  return require(late);
}
loadLate();
