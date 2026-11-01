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
/* Output:
an arrow function of the parameters reads | var x = 2; x | [outer, 2, 2, outer]
an arrow function of the parameters reads | var x; x | [outer, undefined, undefined, outer]
an arrow function of the parameters reads | function x() {} typeof x | [outer, function, function returning undefined, outer]
an arrow function of the parameters reads | { function x() {} } typeof x | [outer, function, function returning undefined, outer]
an arrow function of the parameters reads | let x = 2; x | [outer, 2, outer, outer]
an arrow function of the parameters reads | 'use strict'; var x = 2; x | [outer, 2, outer, outer]
an arrow function of the parameters reads | x = 2; x | [outer, 2, 2, 2]
an arrow function of the parameters reads | x | [outer, outer, outer, outer]
an arrow function of the parameters reads | typeof x | [outer, string, outer, outer]
an arrow function of the parameters reads | delete x | [outer, false, outer, outer]
an arrow function of the parameters reads | var x = 2; delete x | [outer, true, outer, outer]
an arrow function of the parameters reads | eval('var x = 2; x') | [outer, 2, 2, outer]
an arrow function of the parameters reads | eval('eval("var x = 2; x")') | [outer, 2, 2, outer]
an arrow function of the parameters reads | (0, eval)('var x = 2; x') | [outer, 2, outer, outer]
an arrow function of the parameters reads | (() => eval('var x = 2; x'))() | [outer, 2, outer, outer]
an arrow function of the parameters reads | var x = 2; () => x | [outer, function returning 2, 2, outer]
an arrow function of the parameters reads | var y = 3; y | [outer, 3, outer, outer]
an arrow function of the parameters reads | var arguments = 4; arguments | [outer, 4, outer, outer]
an arrow function of the parameters stores | var x = 2; x | [[2, 7, 2], 7]
an arrow function of the parameters stores | var x; x | [[undefined, 7, undefined], 7]
an arrow function of the parameters stores | function x() {} typeof x | [[function, 7, function returning undefined], 7]
an arrow function of the parameters stores | { function x() {} } typeof x | [[function, 7, function returning undefined], 7]
an arrow function of the parameters stores | let x = 2; x | [[2, 7, 7], 7]
an arrow function of the parameters stores | 'use strict'; var x = 2; x | [[2, 7, 7], 7]
an arrow function of the parameters stores | x = 2; x | [[2, 7, 7], 7]
an arrow function of the parameters stores | x | [[outer, 7, 7], 7]
an arrow function of the parameters stores | typeof x | [[string, 7, 7], 7]
an arrow function of the parameters stores | delete x | [[false, 7, 7], 7]
an arrow function of the parameters stores | var x = 2; delete x | [[true, 7, 7], 7]
an arrow function of the parameters stores | eval('var x = 2; x') | [[2, 7, 2], 7]
an arrow function of the parameters stores | eval('eval("var x = 2; x")') | [[2, 7, 2], 7]
an arrow function of the parameters stores | (0, eval)('var x = 2; x') | [[2, 7, 7], 7]
an arrow function of the parameters stores | (() => eval('var x = 2; x'))() | [[2, 7, 7], 7]
an arrow function of the parameters stores | var x = 2; () => x | [[function returning 2, 7, 2], 7]
an arrow function of the parameters stores | var y = 3; y | [[3, 7, 7], 7]
an arrow function of the parameters stores | var arguments = 4; arguments | [[4, 7, 7], 7]
an arrow function of the parameters deletes and asks for the type | var x = 2; x | [2, [string, false, string], number]
an arrow function of the parameters deletes and asks for the type | var x; x | [undefined, [string, false, string], undefined]
an arrow function of the parameters deletes and asks for the type | function x() {} typeof x | [function, [string, false, string], function]
an arrow function of the parameters deletes and asks for the type | { function x() {} } typeof x | [function, [string, false, string], function]
an arrow function of the parameters deletes and asks for the type | let x = 2; x | [2, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | 'use strict'; var x = 2; x | [2, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | x = 2; x | [2, [number, false, number], number]
an arrow function of the parameters deletes and asks for the type | x | [outer, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | typeof x | [string, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | delete x | [false, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | var x = 2; delete x | [true, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | eval('var x = 2; x') | [2, [string, false, string], number]
an arrow function of the parameters deletes and asks for the type | eval('eval("var x = 2; x")') | [2, [string, false, string], number]
an arrow function of the parameters deletes and asks for the type | (0, eval)('var x = 2; x') | [2, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | (() => eval('var x = 2; x'))() | [2, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | var x = 2; () => x | [function returning 2, [string, false, string], number]
an arrow function of the parameters deletes and asks for the type | var y = 3; y | [3, [string, false, string], string]
an arrow function of the parameters deletes and asks for the type | var arguments = 4; arguments | [4, [string, false, string], string]
an arrow function of the parameters calls | var x = 2; x | [2, number, outer]
an arrow function of the parameters calls | var x; x | [undefined, undefined, outer]
an arrow function of the parameters calls | function x() {} typeof x | [function, function, outer]
an arrow function of the parameters calls | { function x() {} } typeof x | [function, function, outer]
an arrow function of the parameters calls | let x = 2; x | [2, function, outer]
an arrow function of the parameters calls | 'use strict'; var x = 2; x | [2, function, outer]
an arrow function of the parameters calls | x = 2; x | TypeError
an arrow function of the parameters calls | x | [function returning outer, function, outer]
an arrow function of the parameters calls | typeof x | [function, function, outer]
an arrow function of the parameters calls | delete x | [false, function, outer]
an arrow function of the parameters calls | var x = 2; delete x | [true, function, outer]
an arrow function of the parameters calls | eval('var x = 2; x') | [2, number, outer]
an arrow function of the parameters calls | eval('eval("var x = 2; x")') | [2, number, outer]
an arrow function of the parameters calls | (0, eval)('var x = 2; x') | [2, function, outer]
an arrow function of the parameters calls | (() => eval('var x = 2; x'))() | [2, function, outer]
an arrow function of the parameters calls | var x = 2; () => x | [function returning 2, number, outer]
an arrow function of the parameters calls | var y = 3; y | [3, function, outer]
an arrow function of the parameters calls | var arguments = 4; arguments | [4, function, outer]
a function of the parameters reads in a with statement | var x = 2; x | [2, 2, outer]
a function of the parameters reads in a with statement | var x; x | [undefined, undefined, outer]
a function of the parameters reads in a with statement | function x() {} typeof x | [function, function returning undefined, outer]
a function of the parameters reads in a with statement | { function x() {} } typeof x | [function, function returning undefined, outer]
a function of the parameters reads in a with statement | let x = 2; x | [2, outer, outer]
a function of the parameters reads in a with statement | 'use strict'; var x = 2; x | [2, outer, outer]
a function of the parameters reads in a with statement | x = 2; x | [2, 2, 2]
a function of the parameters reads in a with statement | x | [outer, outer, outer]
a function of the parameters reads in a with statement | typeof x | [string, outer, outer]
a function of the parameters reads in a with statement | delete x | [false, outer, outer]
a function of the parameters reads in a with statement | var x = 2; delete x | [true, outer, outer]
a function of the parameters reads in a with statement | eval('var x = 2; x') | [2, 2, outer]
a function of the parameters reads in a with statement | eval('eval("var x = 2; x")') | [2, 2, outer]
a function of the parameters reads in a with statement | (0, eval)('var x = 2; x') | [2, outer, outer]
a function of the parameters reads in a with statement | (() => eval('var x = 2; x'))() | [2, outer, outer]
a function of the parameters reads in a with statement | var x = 2; () => x | [function returning 2, 2, outer]
a function of the parameters reads in a with statement | var y = 3; y | [3, outer, outer]
a function of the parameters reads in a with statement | var arguments = 4; arguments | [4, outer, outer]
a function of the parameters evaluates text | var x = 2; x | [2, 2, outer]
a function of the parameters evaluates text | var x; x | [undefined, undefined, outer]
a function of the parameters evaluates text | function x() {} typeof x | [function, function returning undefined, outer]
a function of the parameters evaluates text | { function x() {} } typeof x | [function, function returning undefined, outer]
a function of the parameters evaluates text | let x = 2; x | [2, outer, outer]
a function of the parameters evaluates text | 'use strict'; var x = 2; x | [2, outer, outer]
a function of the parameters evaluates text | x = 2; x | [2, 2, 2]
a function of the parameters evaluates text | x | [outer, outer, outer]
a function of the parameters evaluates text | typeof x | [string, outer, outer]
a function of the parameters evaluates text | delete x | [false, outer, outer]
a function of the parameters evaluates text | var x = 2; delete x | [true, outer, outer]
a function of the parameters evaluates text | eval('var x = 2; x') | [2, 2, outer]
a function of the parameters evaluates text | eval('eval("var x = 2; x")') | [2, 2, outer]
a function of the parameters evaluates text | (0, eval)('var x = 2; x') | [2, outer, outer]
a function of the parameters evaluates text | (() => eval('var x = 2; x'))() | [2, outer, outer]
a function of the parameters evaluates text | var x = 2; () => x | [function returning 2, 2, outer]
a function of the parameters evaluates text | var y = 3; y | [3, outer, outer]
a function of the parameters evaluates text | var arguments = 4; arguments | [4, outer, outer]
a strict function of the parameters evaluates text | var x = 2; x | [2, 2, outer]
a strict function of the parameters evaluates text | var x; x | [undefined, undefined, outer]
a strict function of the parameters evaluates text | function x() {} typeof x | [function, function returning undefined, outer]
a strict function of the parameters evaluates text | { function x() {} } typeof x | [function, function returning undefined, outer]
a strict function of the parameters evaluates text | let x = 2; x | [2, outer, outer]
a strict function of the parameters evaluates text | 'use strict'; var x = 2; x | [2, outer, outer]
a strict function of the parameters evaluates text | x = 2; x | [2, 2, 2]
a strict function of the parameters evaluates text | x | [outer, outer, outer]
a strict function of the parameters evaluates text | typeof x | [string, outer, outer]
a strict function of the parameters evaluates text | delete x | [false, outer, outer]
a strict function of the parameters evaluates text | var x = 2; delete x | [true, outer, outer]
a strict function of the parameters evaluates text | eval('var x = 2; x') | [2, 2, outer]
a strict function of the parameters evaluates text | eval('eval("var x = 2; x")') | [2, 2, outer]
a strict function of the parameters evaluates text | (0, eval)('var x = 2; x') | [2, outer, outer]
a strict function of the parameters evaluates text | (() => eval('var x = 2; x'))() | [2, outer, outer]
a strict function of the parameters evaluates text | var x = 2; () => x | [function returning 2, 2, outer]
a strict function of the parameters evaluates text | var y = 3; y | [3, outer, outer]
a strict function of the parameters evaluates text | var arguments = 4; arguments | [4, outer, outer]
a function of the parameters evaluates the text | var x = 2; x | [[2, 2], outer]
a function of the parameters evaluates the text | var x; x | [[undefined, undefined], outer]
a function of the parameters evaluates the text | function x() {} typeof x | [[function, function returning undefined], outer]
a function of the parameters evaluates the text | { function x() {} } typeof x | [[function, function returning undefined], outer]
a function of the parameters evaluates the text | let x = 2; x | [[2, outer], outer]
a function of the parameters evaluates the text | 'use strict'; var x = 2; x | [[2, outer], outer]
a function of the parameters evaluates the text | x = 2; x | [[2, 2], 2]
a function of the parameters evaluates the text | x | [[outer, outer], outer]
a function of the parameters evaluates the text | typeof x | [[string, outer], outer]
a function of the parameters evaluates the text | delete x | [[false, outer], outer]
a function of the parameters evaluates the text | var x = 2; delete x | [[true, outer], outer]
a function of the parameters evaluates the text | eval('var x = 2; x') | [[2, 2], outer]
a function of the parameters evaluates the text | eval('eval("var x = 2; x")') | [[2, 2], outer]
a function of the parameters evaluates the text | (0, eval)('var x = 2; x') | [[2, outer], outer]
a function of the parameters evaluates the text | (() => eval('var x = 2; x'))() | [[2, outer], outer]
a function of the parameters evaluates the text | var x = 2; () => x | [[function returning 2, 2], outer]
a function of the parameters evaluates the text | var y = 3; y | [[3, outer], outer]
a function of the parameters evaluates the text | var arguments = 4; arguments | [[4, outer], outer]
a later parameter reads | var x = 2; x | [2, 2, 2, 2]
a later parameter reads | var x; x | [undefined, undefined, undefined, undefined]
a later parameter reads | function x() {} typeof x | [function, function returning undefined, function returning undefined, function returning undefined]
a later parameter reads | { function x() {} } typeof x | [function, function returning undefined, function returning undefined, function returning undefined]
a later parameter reads | let x = 2; x | [2, outer, outer, outer]
a later parameter reads | 'use strict'; var x = 2; x | [2, outer, outer, outer]
a later parameter reads | x = 2; x | [2, 2, 2, 2]
a later parameter reads | x | [outer, outer, outer, outer]
a later parameter reads | typeof x | [string, outer, outer, outer]
a later parameter reads | delete x | [false, outer, outer, outer]
a later parameter reads | var x = 2; delete x | [true, outer, outer, outer]
a later parameter reads | eval('var x = 2; x') | [2, 2, 2, 2]
a later parameter reads | eval('eval("var x = 2; x")') | [2, 2, 2, 2]
a later parameter reads | (0, eval)('var x = 2; x') | [2, outer, outer, outer]
a later parameter reads | (() => eval('var x = 2; x'))() | [2, outer, outer, outer]
a later parameter reads | var x = 2; () => x | [function returning 2, 2, 2, 2]
a later parameter reads | var y = 3; y | [3, outer, outer, outer]
a later parameter reads | var arguments = 4; arguments | SyntaxError
both, an arrow function of the parameters reads | var x = 2; x | [1, 2, 1, 1, 2]
both, an arrow function of the parameters reads | var x; x | [1, undefined, 1, 1, undefined]
both, an arrow function of the parameters reads | function x() {} typeof x | [1, function, 1, 1, function returning undefined]
both, an arrow function of the parameters reads | { function x() {} } typeof x | [1, function, 1, 1, function returning undefined]
both, an arrow function of the parameters reads | let x = 2; x | [1, 2, 1, 1, 1]
both, an arrow function of the parameters reads | 'use strict'; var x = 2; x | [1, 2, 1, 1, 1]
both, an arrow function of the parameters reads | x = 2; x | [1, 2, 1, 2, 2]
both, an arrow function of the parameters reads | x | [1, 1, 1, 1, 1]
both, an arrow function of the parameters reads | typeof x | [1, number, 1, 1, 1]
both, an arrow function of the parameters reads | delete x | [1, true, 1, outer, outer]
both, an arrow function of the parameters reads | var x = 2; delete x | [1, true, 1, 1, 1]
both, an arrow function of the parameters reads | eval('var x = 2; x') | [1, 2, 1, 1, 2]
both, an arrow function of the parameters reads | eval('eval("var x = 2; x")') | [1, 2, 1, 1, 2]
both, an arrow function of the parameters reads | (0, eval)('var x = 2; x') | [1, 2, 1, 1, 1]
both, an arrow function of the parameters reads | (() => eval('var x = 2; x'))() | [1, 2, 1, 1, 1]
both, an arrow function of the parameters reads | var x = 2; () => x | [1, function returning 2, 1, 1, 2]
both, an arrow function of the parameters reads | var y = 3; y | [1, 3, 1, 1, 1]
both, an arrow function of the parameters reads | var arguments = 4; arguments | [1, 4, 1, 1, 1]
both, an arrow function of the parameters stores | var x = 2; x | [[2, 7, 2, 7], outer]
both, an arrow function of the parameters stores | var x; x | [[undefined, 7, undefined, 7], outer]
both, an arrow function of the parameters stores | function x() {} typeof x | [[function, 7, function returning undefined, 7], outer]
both, an arrow function of the parameters stores | { function x() {} } typeof x | [[function, 7, function returning undefined, 7], outer]
both, an arrow function of the parameters stores | let x = 2; x | [[2, 7, 7, 7], outer]
both, an arrow function of the parameters stores | 'use strict'; var x = 2; x | [[2, 7, 7, 7], outer]
both, an arrow function of the parameters stores | x = 2; x | [[2, 7, 7, 7], outer]
both, an arrow function of the parameters stores | x | [[1, 7, 7, 7], outer]
both, an arrow function of the parameters stores | typeof x | [[number, 7, 7, 7], outer]
both, an arrow function of the parameters stores | delete x | [[true, 7, 7, 7], 7]
both, an arrow function of the parameters stores | var x = 2; delete x | [[true, 7, 7, 7], outer]
both, an arrow function of the parameters stores | eval('var x = 2; x') | [[2, 7, 2, 7], outer]
both, an arrow function of the parameters stores | eval('eval("var x = 2; x")') | [[2, 7, 2, 7], outer]
both, an arrow function of the parameters stores | (0, eval)('var x = 2; x') | [[2, 7, 7, 7], outer]
both, an arrow function of the parameters stores | (() => eval('var x = 2; x'))() | [[2, 7, 7, 7], outer]
both, an arrow function of the parameters stores | var x = 2; () => x | [[function returning 2, 7, 2, 7], outer]
both, an arrow function of the parameters stores | var y = 3; y | [[3, 7, 7, 7], outer]
both, an arrow function of the parameters stores | var arguments = 4; arguments | [[4, 7, 7, 7], outer]
both, the body deletes | var x = 2; x | [2, 2, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | var x; x | [undefined, undefined, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | function x() {} typeof x | [function, function returning undefined, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | { function x() {} } typeof x | [function, function returning undefined, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | let x = 2; x | [2, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | 'use strict'; var x = 2; x | [2, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | x = 2; x | [2, 2, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | x | [1, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | typeof x | [number, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | delete x | [true, outer, false, outer, outer, false, outer, outer, false, outer]
both, the body deletes | var x = 2; delete x | [true, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | eval('var x = 2; x') | [2, 2, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | eval('eval("var x = 2; x")') | [2, 2, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | (0, eval)('var x = 2; x') | [2, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | (() => eval('var x = 2; x'))() | [2, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | var x = 2; () => x | [function returning outer, 2, true, 1, 1, true, outer, outer, false, outer]
both, the body deletes | var y = 3; y | [3, 1, true, outer, outer, false, outer, outer, false, outer]
both, the body deletes | var arguments = 4; arguments | [4, 1, true, outer, outer, false, outer, outer, false, outer]
both, an arrow function of the parameters deletes | var x = 2; x | [2, true, 2, outer, false, 2, outer]
both, an arrow function of the parameters deletes | var x; x | [undefined, true, undefined, outer, false, undefined, outer]
both, an arrow function of the parameters deletes | function x() {} typeof x | [function, true, function returning undefined, outer, false, function returning undefined, outer]
both, an arrow function of the parameters deletes | { function x() {} } typeof x | [function, true, function returning undefined, outer, false, function returning undefined, outer]
both, an arrow function of the parameters deletes | let x = 2; x | [2, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | 'use strict'; var x = 2; x | [2, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | x = 2; x | [2, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | x | [1, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | typeof x | [number, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | delete x | [true, false, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | var x = 2; delete x | [true, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | eval('var x = 2; x') | [2, true, 2, outer, false, 2, outer]
both, an arrow function of the parameters deletes | eval('eval("var x = 2; x")') | [2, true, 2, outer, false, 2, outer]
both, an arrow function of the parameters deletes | (0, eval)('var x = 2; x') | [2, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | (() => eval('var x = 2; x'))() | [2, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | var x = 2; () => x | [function returning 2, true, 2, outer, false, 2, outer]
both, an arrow function of the parameters deletes | var y = 3; y | [3, true, outer, outer, false, outer, outer]
both, an arrow function of the parameters deletes | var arguments = 4; arguments | [4, true, outer, outer, false, outer, outer]
both, the text among the parameters makes the function that reads | var x = 2; x | [2, 2, 1]
both, the text among the parameters makes the function that reads | var x; x | [undefined, undefined, 1]
both, the text among the parameters makes the function that reads | function x() {} typeof x | [function, function returning undefined, 1]
both, the text among the parameters makes the function that reads | { function x() {} } typeof x | [function, function returning undefined, 1]
both, the text among the parameters makes the function that reads | let x = 2; x | [2, 1, 1]
both, the text among the parameters makes the function that reads | 'use strict'; var x = 2; x | [2, 1, 1]
both, the text among the parameters makes the function that reads | x = 2; x | [2, 2, 2]
both, the text among the parameters makes the function that reads | x | [1, 1, 1]
both, the text among the parameters makes the function that reads | typeof x | [number, 1, 1]
both, the text among the parameters makes the function that reads | delete x | [true, outer, outer]
both, the text among the parameters makes the function that reads | var x = 2; delete x | [true, 1, 1]
both, the text among the parameters makes the function that reads | eval('var x = 2; x') | [2, 2, 1]
both, the text among the parameters makes the function that reads | eval('eval("var x = 2; x")') | [2, 2, 1]
both, the text among the parameters makes the function that reads | (0, eval)('var x = 2; x') | [2, 1, 1]
both, the text among the parameters makes the function that reads | (() => eval('var x = 2; x'))() | [2, 1, 1]
both, the text among the parameters makes the function that reads | var x = 2; () => x | [function returning 2, 2, 1]
both, the text among the parameters makes the function that reads | var y = 3; y | [3, 1, 1]
both, the text among the parameters makes the function that reads | var arguments = 4; arguments | [4, 1, 1]
both, an arrow function of the body reads | var x = 2; x | [1, 2, 2]
both, an arrow function of the body reads | var x; x | [1, undefined, undefined]
both, an arrow function of the body reads | function x() {} typeof x | [1, function, function returning undefined]
both, an arrow function of the body reads | { function x() {} } typeof x | [1, function, function returning undefined]
both, an arrow function of the body reads | let x = 2; x | [1, 2, 1]
both, an arrow function of the body reads | 'use strict'; var x = 2; x | [1, 2, 1]
both, an arrow function of the body reads | x = 2; x | [1, 2, 2]
both, an arrow function of the body reads | x | [1, 1, 1]
both, an arrow function of the body reads | typeof x | [1, number, 1]
both, an arrow function of the body reads | delete x | [1, true, outer]
both, an arrow function of the body reads | var x = 2; delete x | [1, true, 1]
both, an arrow function of the body reads | eval('var x = 2; x') | [1, 2, 2]
both, an arrow function of the body reads | eval('eval("var x = 2; x")') | [1, 2, 2]
both, an arrow function of the body reads | (0, eval)('var x = 2; x') | [1, 2, 1]
both, an arrow function of the body reads | (() => eval('var x = 2; x'))() | [1, 2, 1]
both, an arrow function of the body reads | var x = 2; () => x | [1, function returning 2, 2]
both, an arrow function of the body reads | var y = 3; y | [1, 3, 1]
both, an arrow function of the body reads | var arguments = 4; arguments | [1, 4, 1]
both, the body stores | var x = 2; x | [[2, 9, 1], outer]
both, the body stores | var x; x | [[undefined, 9, 1], outer]
both, the body stores | function x() {} typeof x | [[function, 9, 1], outer]
both, the body stores | { function x() {} } typeof x | [[function, 9, 1], outer]
both, the body stores | let x = 2; x | [[2, 9, 9], outer]
both, the body stores | 'use strict'; var x = 2; x | [[2, 9, 9], outer]
both, the body stores | x = 2; x | [[2, 9, 9], outer]
both, the body stores | x | [[1, 9, 9], outer]
both, the body stores | typeof x | [[number, 9, 9], outer]
both, the body stores | delete x | [[true, 9, 9], 9]
both, the body stores | var x = 2; delete x | [[true, 9, 9], outer]
both, the body stores | eval('var x = 2; x') | [[2, 9, 1], outer]
both, the body stores | eval('eval("var x = 2; x")') | [[2, 9, 1], outer]
both, the body stores | (0, eval)('var x = 2; x') | [[2, 9, 9], outer]
both, the body stores | (() => eval('var x = 2; x'))() | [[2, 9, 9], outer]
both, the body stores | var x = 2; () => x | [[function returning 9, 9, 1], outer]
both, the body stores | var y = 3; y | [[3, 9, 9], outer]
both, the body stores | var arguments = 4; arguments | [[4, 9, 9], outer]
both, the body declares var x | var x = 2; x | [undefined, 2, 2, 1]
both, the body declares var x | var x; x | [undefined, undefined, undefined, 1]
both, the body declares var x | function x() {} typeof x | [undefined, function, function returning undefined, 1]
both, the body declares var x | { function x() {} } typeof x | [undefined, function, function returning undefined, 1]
both, the body declares var x | let x = 2; x | [undefined, 2, undefined, 1]
both, the body declares var x | 'use strict'; var x = 2; x | [undefined, 2, undefined, 1]
both, the body declares var x | x = 2; x | [undefined, 2, 2, 1]
both, the body declares var x | x | [undefined, undefined, undefined, 1]
both, the body declares var x | typeof x | [undefined, undefined, undefined, 1]
both, the body declares var x | delete x | [undefined, false, undefined, 1]
both, the body declares var x | var x = 2; delete x | [undefined, false, 2, 1]
both, the body declares var x | eval('var x = 2; x') | [undefined, 2, 2, 1]
both, the body declares var x | eval('eval("var x = 2; x")') | [undefined, 2, 2, 1]
both, the body declares var x | (0, eval)('var x = 2; x') | [undefined, 2, undefined, 1]
both, the body declares var x | (() => eval('var x = 2; x'))() | [undefined, 2, undefined, 1]
both, the body declares var x | var x = 2; () => x | [undefined, function returning 2, 2, 1]
both, the body declares var x | var y = 3; y | [undefined, 3, undefined, 1]
both, the body declares var x | var arguments = 4; arguments | [undefined, 4, undefined, 1]
both, the body declares let x | var x = 2; x | SyntaxError
both, the body declares let x | var x; x | SyntaxError
both, the body declares let x | function x() {} typeof x | SyntaxError
both, the body declares let x | { function x() {} } typeof x | [8, number, 8, 1]
both, the body declares let x | let x = 2; x | [8, 2, 8, 1]
both, the body declares let x | 'use strict'; var x = 2; x | [8, 2, 8, 1]
both, the body declares let x | x = 2; x | [8, 2, 2, 1]
both, the body declares let x | x | [8, 8, 8, 1]
both, the body declares let x | typeof x | [8, number, 8, 1]
both, the body declares let x | delete x | [8, false, 8, 1]
both, the body declares let x | var x = 2; delete x | SyntaxError
both, the body declares let x | eval('var x = 2; x') | SyntaxError
both, the body declares let x | eval('eval("var x = 2; x")') | SyntaxError
both, the body declares let x | (0, eval)('var x = 2; x') | [8, 2, 8, 1]
both, the body declares let x | (() => eval('var x = 2; x'))() | [8, 2, 8, 1]
both, the body declares let x | var x = 2; () => x | SyntaxError
both, the body declares let x | var y = 3; y | [8, 3, 8, 1]
both, the body declares let x | var arguments = 4; arguments | [8, 4, 8, 1]
both, a function of the body with an arrow function among its parameters | var x = 2; x | [2, 2, 1]
both, a function of the body with an arrow function among its parameters | var x; x | [undefined, undefined, 1]
both, a function of the body with an arrow function among its parameters | function x() {} typeof x | [function, function returning undefined, 1]
both, a function of the body with an arrow function among its parameters | { function x() {} } typeof x | [function, function returning undefined, 1]
both, a function of the body with an arrow function among its parameters | let x = 2; x | [2, 1, 1]
both, a function of the body with an arrow function among its parameters | 'use strict'; var x = 2; x | [2, 1, 1]
both, a function of the body with an arrow function among its parameters | x = 2; x | [2, 2, 2]
both, a function of the body with an arrow function among its parameters | x | [1, 1, 1]
both, a function of the body with an arrow function among its parameters | typeof x | [number, 1, 1]
both, a function of the body with an arrow function among its parameters | delete x | [true, outer, outer]
both, a function of the body with an arrow function among its parameters | var x = 2; delete x | [true, 1, 1]
both, a function of the body with an arrow function among its parameters | eval('var x = 2; x') | [2, 2, 1]
both, a function of the body with an arrow function among its parameters | eval('eval("var x = 2; x")') | [2, 2, 1]
both, a function of the body with an arrow function among its parameters | (0, eval)('var x = 2; x') | [2, 1, 1]
both, a function of the body with an arrow function among its parameters | (() => eval('var x = 2; x'))() | [2, 1, 1]
both, a function of the body with an arrow function among its parameters | var x = 2; () => x | [function returning 2, 2, 1]
both, a function of the body with an arrow function among its parameters | var y = 3; y | [3, 1, 1]
both, a function of the body with an arrow function among its parameters | var arguments = 4; arguments | [4, 1, 1]
both, a function of the body evaluates | var x = 2; x | [[2, 2], 1, 1]
both, a function of the body evaluates | var x; x | [[undefined, undefined], 1, 1]
both, a function of the body evaluates | function x() {} typeof x | [[function, function returning undefined], 1, 1]
both, a function of the body evaluates | { function x() {} } typeof x | [[function, function returning undefined], 1, 1]
both, a function of the body evaluates | let x = 2; x | [[2, 1], 1, 1]
both, a function of the body evaluates | 'use strict'; var x = 2; x | [[2, 1], 1, 1]
both, a function of the body evaluates | x = 2; x | [[2, 2], 2, 2]
both, a function of the body evaluates | x | [[1, 1], 1, 1]
both, a function of the body evaluates | typeof x | [[number, 1], 1, 1]
both, a function of the body evaluates | delete x | [[true, outer], outer, outer]
both, a function of the body evaluates | var x = 2; delete x | [[true, 1], 1, 1]
both, a function of the body evaluates | eval('var x = 2; x') | [[2, 2], 1, 1]
both, a function of the body evaluates | eval('eval("var x = 2; x")') | [[2, 2], 1, 1]
both, a function of the body evaluates | (0, eval)('var x = 2; x') | [[2, 1], 1, 1]
both, a function of the body evaluates | (() => eval('var x = 2; x'))() | [[2, 1], 1, 1]
both, a function of the body evaluates | var x = 2; () => x | [[function returning 2, 2], 1, 1]
both, a function of the body evaluates | var y = 3; y | [[3, 1], 1, 1]
both, a function of the body evaluates | var arguments = 4; arguments | [[4, 1], 1, 1]
both, in a block and in a with statement | var x = 2; x | [2, 2, 1]
both, in a block and in a with statement | var x; x | [undefined, undefined, 1]
both, in a block and in a with statement | function x() {} typeof x | [function, function returning undefined, 1]
both, in a block and in a with statement | { function x() {} } typeof x | [function, function returning undefined, 1]
both, in a block and in a with statement | let x = 2; x | [2, 1, 1]
both, in a block and in a with statement | 'use strict'; var x = 2; x | [2, 1, 1]
both, in a block and in a with statement | x = 2; x | [2, 2, 2]
both, in a block and in a with statement | x | [1, 1, 1]
both, in a block and in a with statement | typeof x | [number, 1, 1]
both, in a block and in a with statement | delete x | [true, outer, outer]
both, in a block and in a with statement | var x = 2; delete x | [true, 1, 1]
both, in a block and in a with statement | eval('var x = 2; x') | [2, 2, 1]
both, in a block and in a with statement | eval('eval("var x = 2; x")') | [2, 2, 1]
both, in a block and in a with statement | (0, eval)('var x = 2; x') | [2, 1, 1]
both, in a block and in a with statement | (() => eval('var x = 2; x'))() | [2, 1, 1]
both, in a block and in a with statement | var x = 2; () => x | [function returning 2, 2, 1]
both, in a block and in a with statement | var y = 3; y | [3, 1, 1]
both, in a block and in a with statement | var arguments = 4; arguments | [4, 1, 1]
two texts among the parameters | var x = 2; x | [1, 2, 2, 2]
two texts among the parameters | var x; x | [1, 1, 1, 1]
two texts among the parameters | function x() {} typeof x | [1, function, function returning undefined, function returning undefined]
two texts among the parameters | { function x() {} } typeof x | [1, function, function returning undefined, function returning undefined]
two texts among the parameters | let x = 2; x | [1, 2, 1, 1]
two texts among the parameters | 'use strict'; var x = 2; x | [1, 2, 1, 1]
two texts among the parameters | x = 2; x | [1, 2, 2, 2]
two texts among the parameters | x | [1, 1, 1, 1]
two texts among the parameters | typeof x | [1, number, 1, 1]
two texts among the parameters | delete x | [1, true, outer, outer]
two texts among the parameters | var x = 2; delete x | [1, true, outer, outer]
two texts among the parameters | eval('var x = 2; x') | [1, 2, 2, 2]
two texts among the parameters | eval('eval("var x = 2; x")') | [1, 2, 2, 2]
two texts among the parameters | (0, eval)('var x = 2; x') | [1, 2, 1, 1]
two texts among the parameters | (() => eval('var x = 2; x'))() | [1, 2, 1, 1]
two texts among the parameters | var x = 2; () => x | [1, function returning 2, 2, 2]
two texts among the parameters | var y = 3; y | [1, 3, 1, 1]
two texts among the parameters | var arguments = 4; arguments | SyntaxError
text among the parameters alone | var x = 2; x | [2, 2, 2, undefined, object]
text among the parameters alone | var x; x | [undefined, undefined, undefined, undefined, object]
text among the parameters alone | function x() {} typeof x | [function, function returning undefined, function returning undefined, undefined, object]
text among the parameters alone | { function x() {} } typeof x | [function, function returning undefined, function returning undefined, undefined, object]
text among the parameters alone | let x = 2; x | [2, outer, outer, undefined, object]
text among the parameters alone | 'use strict'; var x = 2; x | [2, outer, outer, undefined, object]
text among the parameters alone | x = 2; x | [2, 2, 2, undefined, object]
text among the parameters alone | x | [outer, outer, outer, undefined, object]
text among the parameters alone | typeof x | [string, outer, outer, undefined, object]
text among the parameters alone | delete x | [false, outer, outer, undefined, object]
text among the parameters alone | var x = 2; delete x | [true, outer, outer, undefined, object]
text among the parameters alone | eval('var x = 2; x') | [2, 2, 2, undefined, object]
text among the parameters alone | eval('eval("var x = 2; x")') | [2, 2, 2, undefined, object]
text among the parameters alone | (0, eval)('var x = 2; x') | [2, outer, outer, undefined, object]
text among the parameters alone | (() => eval('var x = 2; x'))() | [2, outer, outer, undefined, object]
text among the parameters alone | var x = 2; () => x | [function returning 2, 2, 2, undefined, object]
text among the parameters alone | var y = 3; y | [3, outer, outer, number, object]
text among the parameters alone | var arguments = 4; arguments | SyntaxError
text in a computed key among the parameters | var x = 2; x | [5, 2, 1, 2]
text in a computed key among the parameters | var x; x | [5, undefined, 1, undefined]
text in a computed key among the parameters | function x() {} typeof x | [5, function, 1, function returning undefined]
text in a computed key among the parameters | { function x() {} } typeof x | [5, function, 1, function returning undefined]
text in a computed key among the parameters | let x = 2; x | [5, 2, 1, 1]
text in a computed key among the parameters | 'use strict'; var x = 2; x | [5, 2, 1, 1]
text in a computed key among the parameters | x = 2; x | [5, 2, 2, 2]
text in a computed key among the parameters | x | [5, 1, 1, 1]
text in a computed key among the parameters | typeof x | [5, number, 1, 1]
text in a computed key among the parameters | delete x | [5, true, outer, outer]
text in a computed key among the parameters | var x = 2; delete x | [5, true, 1, 1]
text in a computed key among the parameters | eval('var x = 2; x') | [5, 2, 1, 2]
text in a computed key among the parameters | eval('eval("var x = 2; x")') | [5, 2, 1, 2]
text in a computed key among the parameters | (0, eval)('var x = 2; x') | [5, 2, 1, 1]
text in a computed key among the parameters | (() => eval('var x = 2; x'))() | [5, 2, 1, 1]
text in a computed key among the parameters | var x = 2; () => x | [5, function returning 2, 1, 2]
text in a computed key among the parameters | var y = 3; y | [5, 3, 1, 1]
text in a computed key among the parameters | var arguments = 4; arguments | [5, 4, 1, 1]
a parameter named x | var x = 2; x | [2, 2, 1]
a parameter named x | var x; x | [undefined, undefined, 1]
a parameter named x | function x() {} typeof x | [function, function returning undefined, 1]
a parameter named x | { function x() {} } typeof x | [function, function returning undefined, 1]
a parameter named x | let x = 2; x | [2, 1, 1]
a parameter named x | 'use strict'; var x = 2; x | [2, 1, 1]
a parameter named x | x = 2; x | [2, 2, 2]
a parameter named x | x | [1, 1, 1]
a parameter named x | typeof x | [number, 1, 1]
a parameter named x | delete x | [false, 1, 1]
a parameter named x | var x = 2; delete x | [true, 1, 1]
a parameter named x | eval('var x = 2; x') | [2, 2, 1]
a parameter named x | eval('eval("var x = 2; x")') | [2, 2, 1]
a parameter named x | (0, eval)('var x = 2; x') | [2, 1, 1]
a parameter named x | (() => eval('var x = 2; x'))() | [2, 1, 1]
a parameter named x | var x = 2; () => x | [function returning 2, 2, 1]
a parameter named x | var y = 3; y | [3, 1, 1]
a parameter named x | var arguments = 4; arguments | [4, 1, 1]
a parameter named x, text among the parameters | var x = 2; x | SyntaxError
a parameter named x, text among the parameters | var x; x | SyntaxError
a parameter named x, text among the parameters | function x() {} typeof x | SyntaxError
a parameter named x, text among the parameters | { function x() {} } typeof x | [number, 1, 1]
a parameter named x, text among the parameters | let x = 2; x | [2, 1, 1]
a parameter named x, text among the parameters | 'use strict'; var x = 2; x | [2, 1, 1]
a parameter named x, text among the parameters | x = 2; x | [2, 2, 2]
a parameter named x, text among the parameters | x | [1, 1, 1]
a parameter named x, text among the parameters | typeof x | [number, 1, 1]
a parameter named x, text among the parameters | delete x | [false, 1, 1]
a parameter named x, text among the parameters | var x = 2; delete x | SyntaxError
a parameter named x, text among the parameters | eval('var x = 2; x') | SyntaxError
a parameter named x, text among the parameters | eval('eval("var x = 2; x")') | SyntaxError
a parameter named x, text among the parameters | (0, eval)('var x = 2; x') | [2, 1, 1]
a parameter named x, text among the parameters | (() => eval('var x = 2; x'))() | [2, 1, 1]
a parameter named x, text among the parameters | var x = 2; () => x | SyntaxError
a parameter named x, text among the parameters | var y = 3; y | [3, 1, 1]
a parameter named x, text among the parameters | var arguments = 4; arguments | SyntaxError
arguments | var x = 2; x | [2, object, object]
arguments | var x; x | [undefined, object, object]
arguments | function x() {} typeof x | [function, object, object]
arguments | { function x() {} } typeof x | [function, object, object]
arguments | let x = 2; x | [2, object, object]
arguments | 'use strict'; var x = 2; x | [2, object, object]
arguments | x = 2; x | [2, object, object]
arguments | x | [1, object, object]
arguments | typeof x | [number, object, object]
arguments | delete x | [true, object, object]
arguments | var x = 2; delete x | [true, object, object]
arguments | eval('var x = 2; x') | [2, object, object]
arguments | eval('eval("var x = 2; x")') | [2, object, object]
arguments | (0, eval)('var x = 2; x') | [2, object, object]
arguments | (() => eval('var x = 2; x'))() | [2, object, object]
arguments | var x = 2; () => x | [function returning 2, object, object]
arguments | var y = 3; y | [3, object, object]
arguments | var arguments = 4; arguments | [4, number, object]
arrow function | var x = 2; x | [2, 1, 1, 2]
arrow function | var x; x | [undefined, 1, 1, undefined]
arrow function | function x() {} typeof x | [function, 1, 1, function returning undefined]
arrow function | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
arrow function | let x = 2; x | [2, 1, 1, 1]
arrow function | 'use strict'; var x = 2; x | [2, 1, 1, 1]
arrow function | x = 2; x | [2, 1, 2, 2]
arrow function | x | [1, 1, 1, 1]
arrow function | typeof x | [number, 1, 1, 1]
arrow function | delete x | [true, 1, outer, outer]
arrow function | var x = 2; delete x | [true, 1, 1, 1]
arrow function | eval('var x = 2; x') | [2, 1, 1, 2]
arrow function | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
arrow function | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
arrow function | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
arrow function | var x = 2; () => x | [function returning 2, 1, 1, 2]
arrow function | var y = 3; y | [3, 1, 1, 1]
arrow function | var arguments = 4; arguments | [4, 1, 1, 1]
arrow function, an arrow function of the parameters reads | var x = 2; x | [2, 2, outer]
arrow function, an arrow function of the parameters reads | var x; x | [undefined, undefined, outer]
arrow function, an arrow function of the parameters reads | function x() {} typeof x | [function, function returning undefined, outer]
arrow function, an arrow function of the parameters reads | { function x() {} } typeof x | [function, function returning undefined, outer]
arrow function, an arrow function of the parameters reads | let x = 2; x | [2, outer, outer]
arrow function, an arrow function of the parameters reads | 'use strict'; var x = 2; x | [2, outer, outer]
arrow function, an arrow function of the parameters reads | x = 2; x | [2, 2, 2]
arrow function, an arrow function of the parameters reads | x | [outer, outer, outer]
arrow function, an arrow function of the parameters reads | typeof x | [string, outer, outer]
arrow function, an arrow function of the parameters reads | delete x | [false, outer, outer]
arrow function, an arrow function of the parameters reads | var x = 2; delete x | [true, outer, outer]
arrow function, an arrow function of the parameters reads | eval('var x = 2; x') | [2, 2, outer]
arrow function, an arrow function of the parameters reads | eval('eval("var x = 2; x")') | [2, 2, outer]
arrow function, an arrow function of the parameters reads | (0, eval)('var x = 2; x') | [2, outer, outer]
arrow function, an arrow function of the parameters reads | (() => eval('var x = 2; x'))() | [2, outer, outer]
arrow function, an arrow function of the parameters reads | var x = 2; () => x | [function returning 2, 2, outer]
arrow function, an arrow function of the parameters reads | var y = 3; y | [3, outer, outer]
arrow function, an arrow function of the parameters reads | var arguments = 4; arguments | [4, outer, outer]
arrow function whose body is an expression | var x = 2; x | [2, 1, 1, 2]
arrow function whose body is an expression | var x; x | [undefined, 1, 1, undefined]
arrow function whose body is an expression | function x() {} typeof x | [function, 1, 1, function returning undefined]
arrow function whose body is an expression | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
arrow function whose body is an expression | let x = 2; x | [2, 1, 1, 1]
arrow function whose body is an expression | 'use strict'; var x = 2; x | [2, 1, 1, 1]
arrow function whose body is an expression | x = 2; x | [2, 1, 2, 2]
arrow function whose body is an expression | x | [1, 1, 1, 1]
arrow function whose body is an expression | typeof x | [number, 1, 1, 1]
arrow function whose body is an expression | delete x | [true, 1, outer, outer]
arrow function whose body is an expression | var x = 2; delete x | [true, 1, 1, 1]
arrow function whose body is an expression | eval('var x = 2; x') | [2, 1, 1, 2]
arrow function whose body is an expression | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
arrow function whose body is an expression | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
arrow function whose body is an expression | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
arrow function whose body is an expression | var x = 2; () => x | [function returning 2, 1, 1, 2]
arrow function whose body is an expression | var y = 3; y | [3, 1, 1, 1]
arrow function whose body is an expression | var arguments = 4; arguments | [4, 1, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var x = 2; x | [2, 2, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | var x; x | [undefined, undefined, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | function x() {} typeof x | [function, function returning undefined, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | { function x() {} } typeof x | [function, function returning undefined, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | let x = 2; x | [2, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | 'use strict'; var x = 2; x | [2, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | x = 2; x | [2, 2, 2]
arrow function whose body is an expression, an arrow function of the parameters reads | x | [outer, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | typeof x | [string, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | delete x | [false, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | var x = 2; delete x | [true, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | eval('var x = 2; x') | [2, 2, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | eval('eval("var x = 2; x")') | [2, 2, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | (0, eval)('var x = 2; x') | [2, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | (() => eval('var x = 2; x'))() | [2, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | var x = 2; () => x | [function returning 2, 2, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | var y = 3; y | [3, outer, outer]
arrow function whose body is an expression, an arrow function of the parameters reads | var arguments = 4; arguments | [4, outer, outer]
arrow function whose body is an expression, an arrow function of the body reads | var x = 2; x | [1, 2, 2]
arrow function whose body is an expression, an arrow function of the body reads | var x; x | [1, undefined, undefined]
arrow function whose body is an expression, an arrow function of the body reads | function x() {} typeof x | [1, function, function returning undefined]
arrow function whose body is an expression, an arrow function of the body reads | { function x() {} } typeof x | [1, function, function returning undefined]
arrow function whose body is an expression, an arrow function of the body reads | let x = 2; x | [1, 2, 1]
arrow function whose body is an expression, an arrow function of the body reads | 'use strict'; var x = 2; x | [1, 2, 1]
arrow function whose body is an expression, an arrow function of the body reads | x = 2; x | [1, 2, 2]
arrow function whose body is an expression, an arrow function of the body reads | x | [1, 1, 1]
arrow function whose body is an expression, an arrow function of the body reads | typeof x | [1, number, 1]
arrow function whose body is an expression, an arrow function of the body reads | delete x | [1, true, outer]
arrow function whose body is an expression, an arrow function of the body reads | var x = 2; delete x | [1, true, 1]
arrow function whose body is an expression, an arrow function of the body reads | eval('var x = 2; x') | [1, 2, 2]
arrow function whose body is an expression, an arrow function of the body reads | eval('eval("var x = 2; x")') | [1, 2, 2]
arrow function whose body is an expression, an arrow function of the body reads | (0, eval)('var x = 2; x') | [1, 2, 1]
arrow function whose body is an expression, an arrow function of the body reads | (() => eval('var x = 2; x'))() | [1, 2, 1]
arrow function whose body is an expression, an arrow function of the body reads | var x = 2; () => x | [1, function returning 2, 2]
arrow function whose body is an expression, an arrow function of the body reads | var y = 3; y | [1, 3, 1]
arrow function whose body is an expression, an arrow function of the body reads | var arguments = 4; arguments | [1, 4, 1]
method | var x = 2; x | [2, 1, 1, 2]
method | var x; x | [undefined, 1, 1, undefined]
method | function x() {} typeof x | [function, 1, 1, function returning undefined]
method | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
method | let x = 2; x | [2, 1, 1, 1]
method | 'use strict'; var x = 2; x | [2, 1, 1, 1]
method | x = 2; x | [2, 1, 2, 2]
method | x | [1, 1, 1, 1]
method | typeof x | [number, 1, 1, 1]
method | delete x | [true, 1, outer, outer]
method | var x = 2; delete x | [true, 1, 1, 1]
method | eval('var x = 2; x') | [2, 1, 1, 2]
method | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
method | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
method | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
method | var x = 2; () => x | [function returning 2, 1, 1, 2]
method | var y = 3; y | [3, 1, 1, 1]
method | var arguments = 4; arguments | [4, 1, 1, 1]
setter | var x = 2; x | [2, 1, 1, 2]
setter | var x; x | [undefined, 1, 1, undefined]
setter | function x() {} typeof x | [function, 1, 1, function returning undefined]
setter | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
setter | let x = 2; x | [2, 1, 1, 1]
setter | 'use strict'; var x = 2; x | [2, 1, 1, 1]
setter | x = 2; x | [2, 1, 2, 2]
setter | x | [1, 1, 1, 1]
setter | typeof x | [number, 1, 1, 1]
setter | delete x | [true, 1, outer, outer]
setter | var x = 2; delete x | [true, 1, 1, 1]
setter | eval('var x = 2; x') | [2, 1, 1, 2]
setter | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
setter | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
setter | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
setter | var x = 2; () => x | [function returning 2, 1, 1, 2]
setter | var y = 3; y | [3, 1, 1, 1]
setter | var arguments = 4; arguments | [4, 1, 1, 1]
generator | var x = 2; x | [2, 1, 1, 2]
generator | var x; x | [undefined, 1, 1, undefined]
generator | function x() {} typeof x | [function, 1, 1, function returning undefined]
generator | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
generator | let x = 2; x | [2, 1, 1, 1]
generator | 'use strict'; var x = 2; x | [2, 1, 1, 1]
generator | x = 2; x | [2, 1, 2, 2]
generator | x | [1, 1, 1, 1]
generator | typeof x | [number, 1, 1, 1]
generator | delete x | [true, 1, outer, outer]
generator | var x = 2; delete x | [true, 1, 1, 1]
generator | eval('var x = 2; x') | [2, 1, 1, 2]
generator | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
generator | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
generator | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
generator | var x = 2; () => x | [function returning 2, 1, 1, 2]
generator | var y = 3; y | [3, 1, 1, 1]
generator | var arguments = 4; arguments | [4, 1, 1, 1]
generator, behind a yield | var x = 2; x | [2, 1, 1, 2]
generator, behind a yield | var x; x | [undefined, 1, 1, undefined]
generator, behind a yield | function x() {} typeof x | [function, 1, 1, function returning undefined]
generator, behind a yield | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
generator, behind a yield | let x = 2; x | [2, 1, 1, 1]
generator, behind a yield | 'use strict'; var x = 2; x | [2, 1, 1, 1]
generator, behind a yield | x = 2; x | [2, 1, 2, 2]
generator, behind a yield | x | [1, 1, 1, 1]
generator, behind a yield | typeof x | [number, 1, 1, 1]
generator, behind a yield | delete x | [true, 1, outer, outer]
generator, behind a yield | var x = 2; delete x | [true, 1, 1, 1]
generator, behind a yield | eval('var x = 2; x') | [2, 1, 1, 2]
generator, behind a yield | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
generator, behind a yield | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
generator, behind a yield | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
generator, behind a yield | var x = 2; () => x | [function returning 2, 1, 1, 2]
generator, behind a yield | var y = 3; y | [3, 1, 1, 1]
generator, behind a yield | var arguments = 4; arguments | [4, 1, 1, 1]
async function | var x = 2; x | [2, 1, 1, 2]
async function | var x; x | [undefined, 1, 1, undefined]
async function | function x() {} typeof x | [function, 1, 1, function returning undefined]
async function | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
async function | let x = 2; x | [2, 1, 1, 1]
async function | 'use strict'; var x = 2; x | [2, 1, 1, 1]
async function | x = 2; x | [2, 1, 2, 2]
async function | x | [1, 1, 1, 1]
async function | typeof x | [number, 1, 1, 1]
async function | delete x | [true, 1, outer, outer]
async function | var x = 2; delete x | [true, 1, 1, 1]
async function | eval('var x = 2; x') | [2, 1, 1, 2]
async function | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
async function | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
async function | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
async function | var x = 2; () => x | [function returning 2, 1, 1, 2]
async function | var y = 3; y | [3, 1, 1, 1]
async function | var arguments = 4; arguments | [4, 1, 1, 1]
async arrow function | var x = 2; x | [2, 1, 1, 2]
async arrow function | var x; x | [undefined, 1, 1, undefined]
async arrow function | function x() {} typeof x | [function, 1, 1, function returning undefined]
async arrow function | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
async arrow function | let x = 2; x | [2, 1, 1, 1]
async arrow function | 'use strict'; var x = 2; x | [2, 1, 1, 1]
async arrow function | x = 2; x | [2, 1, 2, 2]
async arrow function | x | [1, 1, 1, 1]
async arrow function | typeof x | [number, 1, 1, 1]
async arrow function | delete x | [true, 1, outer, outer]
async arrow function | var x = 2; delete x | [true, 1, 1, 1]
async arrow function | eval('var x = 2; x') | [2, 1, 1, 2]
async arrow function | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
async arrow function | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
async arrow function | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
async arrow function | var x = 2; () => x | [function returning 2, 1, 1, 2]
async arrow function | var y = 3; y | [3, 1, 1, 1]
async arrow function | var arguments = 4; arguments | [4, 1, 1, 1]
async generator | var x = 2; x | [2, 1, 1, 2]
async generator | var x; x | [undefined, 1, 1, undefined]
async generator | function x() {} typeof x | [function, 1, 1, function returning undefined]
async generator | { function x() {} } typeof x | [function, 1, 1, function returning undefined]
async generator | let x = 2; x | [2, 1, 1, 1]
async generator | 'use strict'; var x = 2; x | [2, 1, 1, 1]
async generator | x = 2; x | [2, 1, 2, 2]
async generator | x | [1, 1, 1, 1]
async generator | typeof x | [number, 1, 1, 1]
async generator | delete x | [true, 1, outer, outer]
async generator | var x = 2; delete x | [true, 1, 1, 1]
async generator | eval('var x = 2; x') | [2, 1, 1, 2]
async generator | eval('eval("var x = 2; x")') | [2, 1, 1, 2]
async generator | (0, eval)('var x = 2; x') | [2, 1, 1, 1]
async generator | (() => eval('var x = 2; x'))() | [2, 1, 1, 1]
async generator | var x = 2; () => x | [function returning 2, 1, 1, 2]
async generator | var y = 3; y | [3, 1, 1, 1]
async generator | var arguments = 4; arguments | [4, 1, 1, 1]
called twice | var x = 2; x | [[2, 1, 1, 2], [0, 0, outer, outer], [2, 1, 1, 2]]
called twice | var x; x | [[undefined, 1, 1, undefined], [0, 0, outer, outer], [undefined, 1, 1, undefined]]
called twice | function x() {} typeof x | [[function, 1, 1, function returning undefined], [0, 0, outer, outer], [function, 1, 1, function returning undefined]]
called twice | { function x() {} } typeof x | [[function, 1, 1, function returning undefined], [0, 0, outer, outer], [function, 1, 1, function returning undefined]]
called twice | let x = 2; x | [[2, 1, 1, 1], [0, 0, outer, outer], [2, 1, 1, 1]]
called twice | 'use strict'; var x = 2; x | [[2, 1, 1, 1], [0, 0, outer, outer], [2, 1, 1, 1]]
called twice | x = 2; x | [[2, 1, 2, 2], [0, 0, outer, outer], [2, 1, 2, 2]]
called twice | x | [[1, 1, 1, 1], [0, 0, outer, outer], [1, 1, 1, 1]]
called twice | typeof x | [[number, 1, 1, 1], [0, 0, outer, outer], [number, 1, 1, 1]]
called twice | delete x | [[true, 1, outer, outer], [0, 0, outer, outer], [true, 1, outer, outer]]
called twice | var x = 2; delete x | [[true, 1, 1, 1], [0, 0, outer, outer], [true, 1, 1, 1]]
called twice | eval('var x = 2; x') | [[2, 1, 1, 2], [0, 0, outer, outer], [2, 1, 1, 2]]
called twice | eval('eval("var x = 2; x")') | [[2, 1, 1, 2], [0, 0, outer, outer], [2, 1, 1, 2]]
called twice | (0, eval)('var x = 2; x') | [[2, 1, 1, 1], [0, 0, outer, outer], [2, 1, 1, 1]]
called twice | (() => eval('var x = 2; x'))() | [[2, 1, 1, 1], [0, 0, outer, outer], [2, 1, 1, 1]]
called twice | var x = 2; () => x | [[function returning 2, 1, 1, 2], [0, 0, outer, outer], [function returning 2, 1, 1, 2]]
called twice | var y = 3; y | [[3, 1, 1, 1], [0, 0, outer, outer], [3, 1, 1, 1]]
called twice | var arguments = 4; arguments | [[4, 1, 1, 1], [0, 0, outer, outer], [4, 1, 1, 1]]
*/
