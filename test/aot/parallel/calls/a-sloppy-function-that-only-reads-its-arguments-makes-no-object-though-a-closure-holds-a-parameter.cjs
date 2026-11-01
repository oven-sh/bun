// Sloppy code, as the files of most packages are. Each function names `arguments`, only reads its length and its elements, stores to no parameter,
// and hands a closure that holds a parameter to code that is not copied in. The parameter is a variable like any other: the closure holds its value,
// not the arguments object, and no arguments object is made.
// COUNT: operation:operationAOTGetById = 0
// COUNT: operation:operationAOTGetByVal = 0
// COUNT: operations <= 100
// COUNT: arrivals <= 9000
// COUNT: cells <= 6010
function copyInto(target) {
  for (var position = 1; position < arguments.length; position++) {
    var source = arguments[position] != null ? arguments[position] : {};
    Object.keys(source).forEach(function (key) {
      target[key] = source[key];
    });
  }
  return target;
}
function countLonger(least) {
  var found = 0;
  for (var position = 1; position < arguments.length; position++)
    found += arguments[position].filter(function (word) {
      return word.length > least;
    }).length;
  return found;
}
var holder = {
  later: function (first) {
    var all = arguments.length;
    return function () {
      return first + all;
    };
  },
};
var base = { a: 1, b: 2 };
var words = ["a", "bb", "ccc"];
var sum = 0;
for (var turn = 0; turn < 1000; turn++) {
  var copy = copyInto({}, base, { c: turn });
  sum += copy.a + copy.b + copy.c;
  sum += countLonger(turn & 1, words, words);
  sum += holder.later(turn, 1, 2)();
}
console.log(sum);
