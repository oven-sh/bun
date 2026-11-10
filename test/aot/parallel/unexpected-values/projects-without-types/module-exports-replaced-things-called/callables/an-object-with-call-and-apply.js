module.exports = {
  call: function (self, value) {
    return "own call " + value;
  },
  apply: function (self, values) {
    return "own apply " + values.length;
  },
  bind: function () {
    return function () {
      return "own bind";
    };
  },
  length: 7,
  name: "not a function",
};
