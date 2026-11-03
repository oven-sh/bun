function load(text) {
  eval(text);
  return require("../real.js");
}
module.exports = {
  real: load(""),
  fake: load("var require = function (name) { return { name: 'not loaded: ' + name, list: 'a text' }; }"),
  realAgain: load(""),
};
