function one() {
  return 1;
}
function two() {
  return 2;
}
function make() {
  return { one };
}
module.exports = { ...make(), ...{ two } };
