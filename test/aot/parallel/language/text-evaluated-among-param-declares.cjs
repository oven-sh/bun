// Text handed to a direct eval in the default of a parameter declares variables and functions: names of the parameters, `arguments`, and new names.
const texts = [
  "var a = 4; a",
  "var a; a",
  "function a() {} typeof a",
  "var b = 4; b",
  "var c = 4; c",
  "var arguments = 4; arguments",
  "var arguments; typeof arguments",
  "function arguments() {} typeof arguments",
  "{ var a = 4; } a",
  "for (var a of [4]); a",
  "var d = 4; d",
  "function d() {} typeof d",
  "let a = 4; a",
  "let arguments = 4; arguments",
  "a = 4; a",
  "(() => { var a = 4; return a; })()",
  "'use strict'; var a = 4; a",
];

const valueOfStep = step => step.value;
const places = [
  [
    "function",
    text =>
      (function (a, b = eval(text), c) {
        return [b, a, c, typeof arguments];
      })(1),
  ],
  [
    "function, the first parameter",
    text =>
      (function (b = eval(text), a, c) {
        return [b, a, c];
      })(undefined, 1),
  ],
  [
    "function whose body declares d",
    text =>
      (function (a, b = eval(text), c) {
        var d = 7;
        return [b, a, d];
      })(1),
  ],
  [
    "function, a later parameter reads d",
    text =>
      (function (a, b = eval(text), c = () => typeof d) {
        return [b, a, c()];
      })(1),
  ],
  [
    "function, in a pattern",
    text =>
      (function (a, { b = eval(text) }, c) {
        return [b, a];
      })(1, {}),
  ],
  [
    "function, in a computed key of a pattern",
    text =>
      (function (a, { [eval(text)]: b }, c) {
        return [b, a];
      })(1, {}),
  ],
  [
    "function, in an arrow of the default",
    text =>
      (function (a, b = (() => eval(text))(), c) {
        return [b, a];
      })(1),
  ],
  [
    "function, in a function of the default",
    text =>
      (function (
        a,
        b = (function () {
          return eval(text);
        })(),
        c,
      ) {
        return [b, a];
      })(1),
  ],
  ["arrow", text => ((a, b = eval(text), c) => [b, a])(1)],
  [
    "arrow with a block",
    text =>
      ((a, b = eval(text), c) => {
        return [b, a];
      })(1),
  ],
  [
    "method",
    text =>
      ({
        m(a, b = eval(text), c) {
          return [b, a];
        },
      }).m(1),
  ],
  [
    "method of a class",
    text =>
      new (class {
        m(a, b = eval(text), c) {
          return [b, a];
        }
      })().m(1),
  ],
  [
    "setter",
    text => {
      let seen;
      ({
        set m([a, b = eval(text)]) {
          seen = [b, a];
        },
      }).m = [1];
      return seen;
    },
  ],
  [
    "function called with new",
    text =>
      new (function (a, b = eval(text), c) {
        this.seen = [b, a];
      })(1).seen,
  ],
  [
    "generator function",
    text =>
      (function* (a, b = eval(text), c) {
        yield [b, a];
      })(1).next().value,
  ],
  [
    "async function",
    text =>
      (async function (a, b = eval(text), c) {
        await 0;
        return [b, a];
      })(1),
  ],
  [
    "async generator function",
    text =>
      (async function* (a, b = eval(text), c) {
        yield [b, a];
      })(1)
        .next()
        .then(valueOfStep),
  ],
];

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function" : String(value);
}

(async () => {
  for (const [place, evaluate] of places) {
    for (const text of texts) {
      let answer;
      try {
        answer = show(await evaluate(text));
      } catch (error) {
        answer = error.constructor.name + ": " + error.message;
      }
      console.log(place + " | " + text + ": " + answer);
    }
  }
})();
