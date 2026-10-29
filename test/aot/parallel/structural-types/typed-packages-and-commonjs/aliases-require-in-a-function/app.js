function load() {
  return require("aliases");
}
console.log(load().x(), load().y);
