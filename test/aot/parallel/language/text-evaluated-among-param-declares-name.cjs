// Text evaluated among the parameters of a sloppy-mode function declares `x`, and a function around it has an `x` too. The new variable belongs to the call: the body reads it, `delete` removes it, and the outer `x` keeps its value. Under `bun run` the text stores to the outer `x`.
function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function" : String(value);
}
function say(label, run) {
  let text;
  try {
    text = show(run());
  } catch (error) {
    text = error.name;
  }
  console.log(label + ": " + text);
}

say("a function expression", () => {
  var x = "outer";
  var result = (function (a, b = eval("var x = 1; x")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("an arrow function", () => {
  var x = "outer";
  var result = ((a, b = eval("var x = 1; x")) => [x, delete x, x])(1);
  return [result, x];
});
say("a method", () => {
  var x = "outer";
  var result = {
    method(a, b = eval("var x = 1; x")) {
      return [x, delete x, x];
    },
  }.method(1);
  return [result, x];
});
say("a generator", () => {
  var x = "outer";
  var result = [
    ...(function* (a, b = eval("var x = 1; x")) {
      yield x;
      yield delete x;
      yield x;
    })(1),
  ];
  return [result, x];
});
say("a function declaration", () => {
  var x = "outer";
  function declared(a, b = eval("var x = 1; x")) {
    return [x, delete x, x];
  }
  return [declared(1), x];
});
say("the outer name is a parameter", () =>
  (function (x) {
    var result = (function (a, b = eval("var x = 1; x")) {
      return [x, delete x, x];
    })(1);
    return [result, x];
  })("outer"),
);
say("the outer name is a let", () => {
  let x = "outer";
  var result = (function (a, b = eval("var x = 1; x")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("the outer name is a const", () => {
  const x = "outer";
  var result = (function (a, b = eval("var x = 1; x")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("the outer name is a function", () => {
  function x() {}
  var result = (function (a, b = eval("var x = 1; x")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
var atTheTop = "outer";
say("the outer name stands at the top of the file", () => {
  var result = (function (a, b = eval("var atTheTop = 1; atTheTop")) {
    return [atTheTop, delete atTheTop, atTheTop];
  })(1);
  return [result, atTheTop];
});
say("the outer name stands two functions out", () => {
  var x = "outer";
  return [
    (function () {
      return (function (a, b = eval("var x = 1; x")) {
        return [x, delete x, x];
      })(1);
    })(),
    x,
  ];
});
say("the text only declares", () => {
  var x = "outer";
  var result = (function (a, b = eval("var x")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("the text declares a function", () => {
  var x = "outer";
  var result = (function (a, b = eval("function x() {}")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("the body stores", () => {
  var x = "outer";
  var result = (function (a, b = eval("var x = 1; x")) {
    x = 2;
    return [x, delete x, x];
  })(1);
  return [result, x];
});
say("a closure among the parameters reads and stores", () => {
  var x = "outer";
  var result = (function (a = eval("var x = 1; x"), read = () => x, store = value => (x = value)) {
    return [read(), store(2), x, delete x, read()];
  })();
  return [result, x];
});
say("the body declares the name too", () => {
  var x = "outer";
  var result = (function (a = eval("var x = 1; x"), read = () => x) {
    var x;
    return [x, read()];
  })();
  return [result, x];
});
say("a call that takes the default, then one that does not", () => {
  var x = "outer";
  function called(a, b = eval("var x = 1; x")) {
    return x;
  }
  return [called(1), called(1, 2), x];
});
say("the default of a name in a pattern", () => {
  var x = "outer";
  var result = (function ({ a = eval("var x = 1; x") }) {
    return [x, delete x, x];
  })({});
  return [result, x];
});
say("a computed key in a pattern", () => {
  var x = "outer";
  var result = (function ({ [eval("var x = 1; 'key'")]: a }) {
    return [x, delete x, x];
  })({});
  return [result, x];
});
say("text inside the text", () => {
  var x = "outer";
  var result = (function (a, b = eval("eval('var x = 1; x')")) {
    return [x, delete x, x];
  })(1);
  return [result, x];
});
/* Output:
a function expression: [[1, true, outer], outer]
an arrow function: [[1, true, outer], outer]
a method: [[1, true, outer], outer]
a generator: [[1, true, outer], outer]
a function declaration: [[1, true, outer], outer]
the outer name is a parameter: [[1, true, outer], outer]
the outer name is a let: [[1, true, outer], outer]
the outer name is a const: [[1, true, outer], outer]
the outer name is a function: [[1, true, function], function]
the outer name stands at the top of the file: [[1, true, outer], outer]
the outer name stands two functions out: [[1, true, outer], outer]
the text only declares: [[undefined, true, outer], outer]
the text declares a function: [[function, true, outer], outer]
the body stores: [[2, true, outer], outer]
a closure among the parameters reads and stores: [[1, 2, 2, true, outer], outer]
the body declares the name too: [[undefined, 1], outer]
a call that takes the default, then one that does not: [1, outer, outer]
the default of a name in a pattern: [[1, true, outer], outer]
a computed key in a pattern: [[1, true, outer], outer]
text inside the text: [[1, true, outer], outer]
*/
