let chosen = function first() {
  return "first";
};
chosen = function second() {
  return "second";
};
module.exports = chosen;
module.exports.member = 1;
chosen = function third() {
  return "third";
};
chosen.late = 2;
