// A function with expressions among its parameters. Text handed to a direct eval in its body declares variables that code among the parameters does not see. Text handed to a direct eval among the parameters declares variables that both see.
const texts = [
  "var x = 2; x",
  "var x; x",
  "function x() {} typeof x",
  "{ function x() {} } typeof x",
  "let x = 2; x",
  "'use strict'; var x = 2; x",
  "x = 2; x",
  "x",
  "typeof x",
  "delete x",
  "var x = 2; delete x",
  "eval('var x = 2; x')",
  "eval('eval(\"var x = 2; x\")')",
  "(0, eval)('var x = 2; x')",
  "(() => eval('var x = 2; x'))()",
  "var x = 2; () => x",
  "var y = 3; y",
  "var arguments = 4; arguments",
];

const valueOfStep = step => step.value;
const places = [
  [
    "an arrow function of the parameters reads",
    text => {
      var x = "outer";
      return (function (a, b = () => x) {
        return [b(), eval(text), x, b()];
      })(1);
    },
  ],
  [
    "an arrow function of the parameters stores",
    text => {
      var x = "outer";
      const result = (function (a, b = value => (x = value)) {
        return [eval(text), b(7), x];
      })(1);
      return [result, x];
    },
  ],
  [
    "an arrow function of the parameters deletes and asks for the type",
    text => {
      var x = "outer";
      return (function (a, b = () => [typeof x, delete x, typeof x]) {
        return [eval(text), b(), typeof x];
      })(1);
    },
  ],
  [
    "an arrow function of the parameters calls",
    text => {
      var x = () => "outer";
      return (function (a, b = () => x()) {
        return [eval(text), typeof x, b()];
      })(1);
    },
  ],
  [
    "a function of the parameters reads in a with statement",
    text => {
      var x = "outer";
      return (function (
        a,
        b = function () {
          with ({}) return x;
        },
      ) {
        return [eval(text), x, b()];
      })(1);
    },
  ],
  [
    "a function of the parameters evaluates text",
    text => {
      var x = "outer";
      return (function (a, b = () => eval("x")) {
        return [eval(text), x, b()];
      })(1);
    },
  ],
  [
    "a strict function of the parameters evaluates text",
    text => {
      var x = "outer";
      return (function (
        a,
        b = function () {
          "use strict";
          return eval("x");
        },
      ) {
        return [eval(text), x, b()];
      })(1);
    },
  ],
  [
    "a function of the parameters evaluates the text",
    text => {
      var x = "outer";
      return (function (a, b = () => [eval(text), x]) {
        return [b(), x];
      })(1);
    },
  ],
  [
    "a later parameter reads",
    text => {
      var x = "outer";
      return (function (a, b = eval(text), c = x, d = () => x) {
        return [b, c, d(), x];
      })(1);
    },
  ],
  [
    "both, an arrow function of the parameters reads",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        return [x, eval(text), b, c(), x];
      })(1);
    },
  ],
  [
    "both, an arrow function of the parameters stores",
    text => {
      var x = "outer";
      const result = (function (a, b = eval("var x = 1; x"), c = value => (x = value), d = () => x) {
        return [eval(text), c(7), x, d()];
      })(1);
      return [result, x];
    },
  ],
  [
    "both, the body deletes",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        return [eval(text), x, delete x, x, c(), delete x, x, c(), delete x, x];
      })(1);
    },
  ],
  [
    "both, an arrow function of the parameters deletes",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => delete x, d = () => x) {
        return [eval(text), c(), x, d(), c(), x, d()];
      })(1);
    },
  ],
  [
    "both, the text among the parameters makes the function that reads",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; () => x")) {
        return [eval(text), x, b()];
      })(1);
    },
  ],
  [
    "both, an arrow function of the body reads",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x")) {
        const read = () => x;
        return [read(), eval(text), read()];
      })(1);
    },
  ],
  [
    "both, the body stores",
    text => {
      var x = "outer";
      const result = (function (a, b = eval("var x = 1; x"), c = () => x) {
        const evaluated = eval(text);
        x = 9;
        return [evaluated, x, c()];
      })(1);
      return [result, x];
    },
  ],
  [
    "both, the body declares var x",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        var x;
        return [x, eval(text), x, c()];
      })(1);
    },
  ],
  [
    "both, the body declares let x",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        let x = 8;
        return [x, eval(text), x, c()];
      })(1);
    },
  ],
  [
    "both, a function of the body with an arrow function among its parameters",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        const evaluated = eval(text);
        return [
          evaluated,
          (function (d = () => x) {
            return d();
          })(),
          c(),
        ];
      })(1);
    },
  ],
  [
    "both, a function of the body evaluates",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        return [
          (function () {
            return [eval(text), x];
          })(),
          x,
          c(),
        ];
      })(1);
    },
  ],
  [
    "both, in a block and in a with statement",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = () => x) {
        {
          with ({}) {
            return [eval(text), x, c()];
          }
        }
      })(1);
    },
  ],
  [
    "two texts among the parameters",
    text => {
      var x = "outer";
      return (function (a, b = eval("var x = 1; x"), c = eval(text), d = () => x) {
        return [b, c, d(), x];
      })(1);
    },
  ],
  [
    "text among the parameters alone",
    text => {
      var x = "outer";
      return (function (a, b = eval(text), c = () => x) {
        return [b, c(), x, typeof y, typeof arguments];
      })(1);
    },
  ],
  [
    "text in a computed key among the parameters",
    text => {
      var x = "outer";
      return (function ({ [eval("var x = 1; 'k'")]: a }, c = () => x) {
        return [a, eval(text), c(), x];
      })({ k: 5 });
    },
  ],
  [
    "a parameter named x",
    text =>
      (function (x, b = () => x) {
        return [eval(text), x, b()];
      })(1),
  ],
  [
    "a parameter named x, text among the parameters",
    text =>
      (function (x, b = eval(text), c = () => x) {
        return [b, x, c()];
      })(1),
  ],
  [
    "arguments",
    text =>
      (function (a, b = () => typeof arguments, c = eval("var x = 1; x")) {
        return [eval(text), typeof arguments, b()];
      })(1),
  ],
  [
    "arrow function",
    text => {
      var x = "outer";
      return ((a, b = eval("var x = 1; x"), c = () => x) => {
        return [eval(text), b, c(), x];
      })(1);
    },
  ],
  [
    "arrow function, an arrow function of the parameters reads",
    text => {
      var x = "outer";
      return ((a, b = () => x) => {
        return [eval(text), x, b()];
      })(1);
    },
  ],
  [
    "arrow function whose body is an expression",
    text => {
      var x = "outer";
      return ((a, b = eval("var x = 1; x"), c = () => x) => [eval(text), b, c(), x])(1);
    },
  ],
  [
    "arrow function whose body is an expression, an arrow function of the parameters reads",
    text => {
      var x = "outer";
      return ((a, b = () => x) => [eval(text), x, b()])(1);
    },
  ],
  [
    "arrow function whose body is an expression, an arrow function of the body reads",
    text => {
      var x = "outer";
      return ((a, b = eval("var x = 1; x")) => [(() => x)(), eval(text), (() => x)()])(1);
    },
  ],
  [
    "method",
    text => {
      var x = "outer";
      return {
        m(a, b = eval("var x = 1; x"), c = () => x) {
          return [eval(text), b, c(), x];
        },
      }.m(1);
    },
  ],
  [
    "setter",
    text => {
      var x = "outer";
      let result;
      ({
        set s([a, b = eval("var x = 1; x"), c = () => x]) {
          result = [eval(text), b, c(), x];
        },
      }).s = [1];
      return result;
    },
  ],
  [
    "generator",
    text => {
      var x = "outer";
      return (function* (a, b = eval("var x = 1; x"), c = () => x) {
        yield [eval(text), b, c(), x];
      })(1).next().value;
    },
  ],
  [
    "generator, behind a yield",
    text => {
      var x = "outer";
      const steps = (function* (a, b = eval("var x = 1; x"), c = () => x) {
        const evaluated = eval(text);
        yield;
        yield [evaluated, b, c(), x];
      })(1);
      steps.next();
      return steps.next().value;
    },
  ],
  [
    "async function",
    text => {
      var x = "outer";
      return (async function (a, b = eval("var x = 1; x"), c = () => x) {
        const evaluated = eval(text);
        await 0;
        return [evaluated, b, c(), x];
      })(1);
    },
  ],
  [
    "async arrow function",
    text => {
      var x = "outer";
      return (async (a, b = eval("var x = 1; x"), c = () => x) => {
        const evaluated = eval(text);
        await 0;
        return [evaluated, b, c(), x];
      })(1);
    },
  ],
  [
    "async generator",
    text => {
      var x = "outer";
      return (async function* (a, b = eval("var x = 1; x"), c = () => x) {
        yield [eval(text), b, c(), x];
      })(1)
        .next()
        .then(valueOfStep);
    },
  ],
  [
    "called twice",
    text => {
      var x = "outer";
      function f(a, b = a && eval("var x = 1; x"), c = () => x) {
        return [a && eval(text), b, c(), x];
      }
      return [f(1), f(0), f(1)];
    },
  ],
];

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function returning " + show(value()) : String(value);
}

(async () => {
  for (const [place, run] of places) {
    for (const text of texts) {
      let shown;
      try {
        shown = show(await run(text));
      } catch (error) {
        shown = error.name;
      }
      delete globalThis.x;
      console.log(place + " | " + text + " | " + shown);
    }
  }
})();
