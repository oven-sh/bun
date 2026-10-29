exports.honest = function () {
  return ["a", "b", "c", "d"];
};
exports.text = function () {
  return "abcd";
};
exports.boxed = function () {
  return new String("abcd");
};
exports.bytes = function () {
  return Buffer.from("abcd");
};
exports.typed = function () {
  return new Uint16Array([97, 98, 99, 100]);
};
exports.passed = function () {
  return (function () {
    return arguments;
  })("a", "b", "c", "d");
};
exports.like = function () {
  return { 0: "a", 1: "b", 2: "c", 3: "d", length: 4 };
};
exports.heir = function () {
  return Object.create(["a", "b", "c", "d"]);
};
exports.parsed = function () {
  return JSON.parse('{"0":"a","1":"b","2":"c","3":"d","length":4,"slice":"not a function"}');
};
exports.evaluated = function () {
  return (0, eval)("'ab' + 'cd'");
};
