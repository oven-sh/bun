module.exports = function legacy(text) {
  return text + "!";
};
module.exports.helper = function (text) {
  return text.toUpperCase();
};
