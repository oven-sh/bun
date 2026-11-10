var held = {
  sum: function (a, b) {
    for (var i = 0; i < 3; i++) a += i;
    return a + b + i + arguments.length;
  },
};
module.exports = held;
