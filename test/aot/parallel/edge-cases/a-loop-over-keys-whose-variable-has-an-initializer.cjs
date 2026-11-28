// The initializer of a `for..in` runs where there is no key, and an eval reads the variable.
function read() {
  for (var kept = "initial" in {});
  return eval("(function () { return '" + kept + "'; })")();
}
console.log(read());
function load() {
  for (var name = "node:path" in {});
  return require(name);
}
console.log(typeof load().join);
