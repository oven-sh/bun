// A string or a number in brackets is the only expression among the parameters. Text handed to a direct eval in the body declares the names of the parameters, `arguments`, and new names.
const texts = [
  "var a; a",
  "var a = 4; a",
  "function a() {} typeof a",
  "var arguments; typeof arguments",
  "var arguments = 4; arguments",
  "{ var a = 4; } a",
  "var a = 4; delete a",
  "var d = 4; d",
  "a = 4; a",
  "let a = 4; a",
  "delete a",
  "'use strict'; var a = 4; a",
];

const valueOfStep = step => step.value;
const places = [
  [
    "a string",
    text =>
      (function ({ ["a"]: a }) {
        return [a, eval(text), a, typeof arguments];
      })({ a: 1 }),
  ],
  [
    "a number",
    text =>
      (function ({ [0]: a }) {
        return [a, eval(text), a, typeof arguments];
      })([1]),
  ],
  [
    "a template without substitutions",
    text =>
      (function ({ [`a`]: a }) {
        return [a, eval(text), a, typeof arguments];
      })({ a: 1 }),
  ],
  [
    "a string in a pattern inside a pattern",
    text =>
      (function ([{ ["a"]: a }]) {
        return [a, eval(text), a, typeof arguments];
      })([{ a: 1 }]),
  ],
  [
    "a string in the pattern of a rest parameter",
    text =>
      (function (...[{ ["a"]: a }]) {
        return [a, eval(text), a, typeof arguments];
      })({ a: 1 }),
  ],
  [
    "a string in the pattern of another parameter",
    text =>
      (function (a, { ["b"]: b }) {
        return [a, eval(text), a, b, typeof arguments];
      })(1, { b: 2 }),
  ],
  [
    "stores and deletes",
    text =>
      (function ({ ["a"]: a }) {
        const evaluated = eval(text);
        a = 9;
        const stored = a;
        a += 1;
        return [evaluated, stored, a, typeof a, delete a, a];
      })({ a: 1 }),
  ],
  [
    "an arrow function of the body reads",
    text =>
      (function ({ ["a"]: a }) {
        const read = () => a;
        return [read(), eval(text), read()];
      })({ a: 1 }),
  ],
  [
    "the body declares var a",
    text =>
      (function ({ ["a"]: a }) {
        var a;
        return [a, eval(text), a];
      })({ a: 1 }),
  ],
  [
    "the body declares function a",
    text =>
      (function ({ ["a"]: a }) {
        function a() {}
        return [typeof a, eval(text), typeof a];
      })({ a: 1 }),
  ],
  [
    "arrow function",
    text =>
      (({ ["a"]: a }) => {
        return [a, eval(text), a];
      })({ a: 1 }),
  ],
  ["arrow function whose body is an expression", text => (({ ["a"]: a }) => [a, eval(text), a])({ a: 1 })],
  [
    "method",
    text =>
      ({
        m({ ["a"]: a }) {
          return [a, eval(text), a, typeof arguments];
        },
      }).m({ a: 1 }),
  ],
  [
    "generator",
    text =>
      (function* ({ ["a"]: a }) {
        yield [a, eval(text), a, typeof arguments];
      })({ a: 1 }).next().value,
  ],
  [
    "async function",
    text =>
      (async function ({ ["a"]: a }) {
        const evaluated = eval(text);
        await 0;
        return [evaluated, a, typeof arguments];
      })({ a: 1 }),
  ],
  [
    "async generator",
    text =>
      (async function* ({ ["a"]: a }) {
        yield [eval(text), a, typeof arguments];
      })({ a: 1 })
        .next()
        .then(valueOfStep),
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
