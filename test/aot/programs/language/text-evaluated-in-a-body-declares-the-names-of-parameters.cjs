// Text handed to a direct eval in the body of a function declares variables and functions: names of the parameters, `arguments`, and new names. The parameters hold a default value or a computed key.
const texts = [
  "var a; a",
  "var a = 4; a",
  "function a() {} typeof a",
  "var b; b",
  "var arguments; typeof arguments",
  "var arguments = 4; arguments",
  "function arguments() {} typeof arguments",
  "{ var a = 4; } a",
  "for (var a of [4]); a",
  "{ function a() {} } typeof a",
  "var a = 4; delete a",
  "var d = 4; d",
  "a = 4; a",
  "arguments = 4; arguments",
  "let a = 4; a",
  "delete a",
  "(() => { var a = 4; return a; })()",
  "'use strict'; var a = 4; a",
];

const nameOfA = "a";
const valueOfStep = step => step.value;
const places = [
  [
    "function",
    text =>
      (function (a, b = 2) {
        return [a, eval(text), a, b, typeof arguments];
      })(1),
  ],
  [
    "function, stores and deletes",
    text =>
      (function (a, b = 2) {
        const evaluated = eval(text);
        a = 9;
        const stored = a;
        a += 1;
        a++;
        return [evaluated, stored, a, typeof a, delete a, a];
      })(1),
  ],
  [
    "function, stores through patterns",
    text =>
      (function (a, b = 2) {
        const evaluated = eval(text);
        [a] = [9];
        const first = a;
        ({ a } = { a: 8 });
        const second = a;
        for (a of [7]);
        return [evaluated, first, second, a, delete a, a];
      })(1),
  ],
  [
    "function, calls",
    text =>
      (function (a, b = 2) {
        return [eval(text), typeof a === "function" ? typeof a() : "no function"];
      })(() => 1),
  ],
  [
    "function, deletes arguments",
    text =>
      (function (a, b = 2) {
        return [eval(text), typeof arguments, delete arguments, typeof arguments];
      })(1),
  ],
  [
    "an arrow function of the body reads",
    text =>
      (function (a, b = 2) {
        const read = () => [a, typeof arguments];
        return [read(), eval(text), read()];
      })(1),
  ],
  [
    "an arrow function of the body stores",
    text =>
      (function (a, b = 2) {
        const store = value => {
          a = value;
        };
        const evaluated = eval(text);
        store(9);
        return [evaluated, a, delete a, a];
      })(1),
  ],
  [
    "an arrow function of the parameters reads",
    text =>
      (function (a, b = () => [a, typeof arguments]) {
        return [eval(text), a, b()];
      })(1),
  ],
  [
    "an arrow function of the parameters stores",
    text =>
      (function (a, b = value => (a = value)) {
        const evaluated = eval(text);
        b(9);
        return [evaluated, a, delete a, a];
      })(1),
  ],
  [
    "the body declares var a",
    text =>
      (function (a, b = () => a) {
        var a;
        return [eval(text), a, b()];
      })(1),
  ],
  [
    "the body declares function a",
    text =>
      (function (a, b = () => a) {
        function a() {}
        return [eval(text), typeof a, b()];
      })(1),
  ],
  [
    "the body declares var arguments",
    text =>
      (function (a, b = 2) {
        var arguments;
        return [eval(text), a, typeof arguments];
      })(1),
  ],
  [
    "the body declares var d",
    text =>
      (function (a, b = 2) {
        var d = 7;
        return [eval(text), a, d];
      })(1),
  ],
  [
    "the body declares let d",
    text =>
      (function (a, b = 2) {
        let d = 7;
        return [eval(text), a, d];
      })(1),
  ],
  [
    "two texts",
    text =>
      (function (a, b = 2) {
        return [eval(text), eval("[a, typeof arguments]"), eval("var a; a"), a];
      })(1),
  ],
  [
    "in a block",
    text =>
      (function (a, b = 2) {
        {
          let c = eval(text);
          return [c, a];
        }
      })(1),
  ],
  [
    "in a with statement",
    text =>
      (function (a, b = 2) {
        with ({}) {
          return [eval(text), a, typeof arguments];
        }
      })(1),
  ],
  [
    "before a with statement",
    text =>
      (function (a, b = 2) {
        const evaluated = eval(text);
        with ({ b: 3 }) {
          return [evaluated, a, b, typeof arguments];
        }
      })(1),
  ],
  [
    "in an arrow function of the body",
    text =>
      (function (a, b = 2) {
        return [(() => [eval(text), a, typeof arguments])(), a, typeof arguments];
      })(1),
  ],
  [
    "in an arrow function of the body, behind a text of the body",
    text =>
      (function (a, b = 2) {
        eval("var a = 6");
        return [(() => [eval(text), a])(), a];
      })(1),
  ],
  [
    "in a method of a class of the body, behind a text of the body",
    text =>
      (function (a, b = 2) {
        eval("var a = 6");
        return [
          class {
            static m() {
              return [eval(text), a];
            }
          }.m(),
          a,
        ];
      })(1),
  ],
  [
    "a pattern with a default",
    text =>
      (function ({ a = 1 }, b) {
        return [eval(text), a, typeof arguments];
      })({}),
  ],
  [
    "a pattern with a computed key",
    text =>
      (function ({ [nameOfA]: a }, b) {
        return [eval(text), a, typeof arguments];
      })({ a: 1 }),
  ],
  [
    "a default and a rest",
    text =>
      (function (b = 2, ...a) {
        return [eval(text), String(a), typeof arguments];
      })(undefined, 1),
  ],
  [
    "a parameter named arguments",
    text =>
      (function (arguments, a = 1) {
        return [eval(text), a, arguments];
      })(5),
  ],
  [
    "arrow function",
    text =>
      ((a, b = 2) => {
        return [a, eval(text), a, b];
      })(1),
  ],
  ["arrow function whose body is an expression", text => ((a, b = 2) => [a, eval(text), a, b])(1)],
  [
    "arrow function whose body is an expression, an arrow function of the parameters reads",
    text => ((a, b = () => a) => [eval(text), a, b()])(1),
  ],
  [
    "method",
    text =>
      ({
        m(a, b = 2) {
          return [eval(text), a, typeof arguments];
        },
      }).m(1),
  ],
  [
    "setter",
    text => {
      let seen;
      ({
        set s([a, b = 2]) {
          seen = [eval(text), a, typeof arguments];
        },
      }).s = [1];
      return seen;
    },
  ],
  [
    "generator",
    text =>
      valueOfStep(
        (function* (a, b = 2) {
          yield [eval(text), a, typeof arguments];
        })(1).next(),
      ),
  ],
  [
    "generator, behind a yield",
    text => {
      const generator = (function* (a, b = 2) {
        const evaluated = eval(text);
        yield;
        yield [evaluated, a, typeof arguments];
      })(1);
      generator.next();
      return valueOfStep(generator.next());
    },
  ],
  [
    "async function",
    text =>
      (async function (a, b = 2) {
        const evaluated = eval(text);
        await 0;
        return [evaluated, a, typeof arguments];
      })(1),
  ],
  [
    "async arrow function",
    text =>
      (async (a, b = 2) => {
        const evaluated = eval(text);
        await 0;
        return [evaluated, a];
      })(1),
  ],
  [
    "async generator",
    text =>
      (async function* (a, b = 2) {
        yield [eval(text), a, typeof arguments];
      })(1)
        .next()
        .then(valueOfStep),
  ],
  [
    "function without expressions among its parameters",
    text =>
      (function (a, b) {
        return [a, eval(text), a, b, typeof arguments];
      })(1),
  ],
];

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function" : String(value);
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
      console.log(place + " | " + text + " | " + shown);
    }
  }
})();
