module.exports = function load(name) {
  return require("./data/" + name + ".json");
};
