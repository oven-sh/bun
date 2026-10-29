var show = require("./show").show;
var a = require("./a");
var late = a.late;
var count = a.count;
var double = a.double;

function tried(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
function lengthOfLate() {
  return a.late.length;
}
function nextCount() {
  return a.count + 1;
}
function doubled() {
  return a.double(4);
}
function nextStep() {
  return a.step + 1;
}

exports.seen = {
  keys: Object.keys(a).join(),
  early: tried(function () { return a.early.length; }),
  late: tried(lengthOfLate),
  count: tried(nextCount),
  doubled: tried(doubled),
  step: tried(nextStep),
};
exports.now = function () {
  return [Object.keys(a).join(), tried(lengthOfLate), tried(nextCount), tried(doubled), tried(nextStep)];
};
exports.copies = function () {
  return [tried(function () { return late.length; }), tried(function () { return count + 1; }), tried(function () { return double(4); })];
};
