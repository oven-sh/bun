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
/* Output:
a string | var a; a | [1, undefined, undefined, object]
a string | var a = 4; a | [1, 4, 4, object]
a string | function a() {} typeof a | [1, function, function, object]
a string | var arguments; typeof arguments | [1, undefined, 1, undefined]
a string | var arguments = 4; arguments | [1, 4, 1, number]
a string | { var a = 4; } a | [1, 4, 4, object]
a string | var a = 4; delete a | [1, true, 1, object]
a string | var d = 4; d | [1, 4, 1, object]
a string | a = 4; a | [1, 4, 4, object]
a string | let a = 4; a | [1, 4, 1, object]
a string | delete a | [1, false, 1, object]
a string | 'use strict'; var a = 4; a | [1, 4, 1, object]
a number | var a; a | [1, undefined, undefined, object]
a number | var a = 4; a | [1, 4, 4, object]
a number | function a() {} typeof a | [1, function, function, object]
a number | var arguments; typeof arguments | [1, undefined, 1, undefined]
a number | var arguments = 4; arguments | [1, 4, 1, number]
a number | { var a = 4; } a | [1, 4, 4, object]
a number | var a = 4; delete a | [1, true, 1, object]
a number | var d = 4; d | [1, 4, 1, object]
a number | a = 4; a | [1, 4, 4, object]
a number | let a = 4; a | [1, 4, 1, object]
a number | delete a | [1, false, 1, object]
a number | 'use strict'; var a = 4; a | [1, 4, 1, object]
a template without substitutions | var a; a | [1, undefined, undefined, object]
a template without substitutions | var a = 4; a | [1, 4, 4, object]
a template without substitutions | function a() {} typeof a | [1, function, function, object]
a template without substitutions | var arguments; typeof arguments | [1, undefined, 1, undefined]
a template without substitutions | var arguments = 4; arguments | [1, 4, 1, number]
a template without substitutions | { var a = 4; } a | [1, 4, 4, object]
a template without substitutions | var a = 4; delete a | [1, true, 1, object]
a template without substitutions | var d = 4; d | [1, 4, 1, object]
a template without substitutions | a = 4; a | [1, 4, 4, object]
a template without substitutions | let a = 4; a | [1, 4, 1, object]
a template without substitutions | delete a | [1, false, 1, object]
a template without substitutions | 'use strict'; var a = 4; a | [1, 4, 1, object]
a string in a pattern inside a pattern | var a; a | [1, undefined, undefined, object]
a string in a pattern inside a pattern | var a = 4; a | [1, 4, 4, object]
a string in a pattern inside a pattern | function a() {} typeof a | [1, function, function, object]
a string in a pattern inside a pattern | var arguments; typeof arguments | [1, undefined, 1, undefined]
a string in a pattern inside a pattern | var arguments = 4; arguments | [1, 4, 1, number]
a string in a pattern inside a pattern | { var a = 4; } a | [1, 4, 4, object]
a string in a pattern inside a pattern | var a = 4; delete a | [1, true, 1, object]
a string in a pattern inside a pattern | var d = 4; d | [1, 4, 1, object]
a string in a pattern inside a pattern | a = 4; a | [1, 4, 4, object]
a string in a pattern inside a pattern | let a = 4; a | [1, 4, 1, object]
a string in a pattern inside a pattern | delete a | [1, false, 1, object]
a string in a pattern inside a pattern | 'use strict'; var a = 4; a | [1, 4, 1, object]
a string in the pattern of a rest parameter | var a; a | [1, undefined, undefined, object]
a string in the pattern of a rest parameter | var a = 4; a | [1, 4, 4, object]
a string in the pattern of a rest parameter | function a() {} typeof a | [1, function, function, object]
a string in the pattern of a rest parameter | var arguments; typeof arguments | [1, undefined, 1, undefined]
a string in the pattern of a rest parameter | var arguments = 4; arguments | [1, 4, 1, number]
a string in the pattern of a rest parameter | { var a = 4; } a | [1, 4, 4, object]
a string in the pattern of a rest parameter | var a = 4; delete a | [1, true, 1, object]
a string in the pattern of a rest parameter | var d = 4; d | [1, 4, 1, object]
a string in the pattern of a rest parameter | a = 4; a | [1, 4, 4, object]
a string in the pattern of a rest parameter | let a = 4; a | [1, 4, 1, object]
a string in the pattern of a rest parameter | delete a | [1, false, 1, object]
a string in the pattern of a rest parameter | 'use strict'; var a = 4; a | [1, 4, 1, object]
a string in the pattern of another parameter | var a; a | [1, undefined, undefined, 2, object]
a string in the pattern of another parameter | var a = 4; a | [1, 4, 4, 2, object]
a string in the pattern of another parameter | function a() {} typeof a | [1, function, function, 2, object]
a string in the pattern of another parameter | var arguments; typeof arguments | [1, undefined, 1, 2, undefined]
a string in the pattern of another parameter | var arguments = 4; arguments | [1, 4, 1, 2, number]
a string in the pattern of another parameter | { var a = 4; } a | [1, 4, 4, 2, object]
a string in the pattern of another parameter | var a = 4; delete a | [1, true, 1, 2, object]
a string in the pattern of another parameter | var d = 4; d | [1, 4, 1, 2, object]
a string in the pattern of another parameter | a = 4; a | [1, 4, 4, 2, object]
a string in the pattern of another parameter | let a = 4; a | [1, 4, 1, 2, object]
a string in the pattern of another parameter | delete a | [1, false, 1, 2, object]
a string in the pattern of another parameter | 'use strict'; var a = 4; a | [1, 4, 1, 2, object]
stores and deletes | var a; a | [undefined, 9, 10, number, true, 1]
stores and deletes | var a = 4; a | [4, 9, 10, number, true, 1]
stores and deletes | function a() {} typeof a | [function, 9, 10, number, true, 1]
stores and deletes | var arguments; typeof arguments | [undefined, 9, 10, number, false, 10]
stores and deletes | var arguments = 4; arguments | [4, 9, 10, number, false, 10]
stores and deletes | { var a = 4; } a | [4, 9, 10, number, true, 1]
stores and deletes | var a = 4; delete a | [true, 9, 10, number, false, 10]
stores and deletes | var d = 4; d | [4, 9, 10, number, false, 10]
stores and deletes | a = 4; a | [4, 9, 10, number, false, 10]
stores and deletes | let a = 4; a | [4, 9, 10, number, false, 10]
stores and deletes | delete a | [false, 9, 10, number, false, 10]
stores and deletes | 'use strict'; var a = 4; a | [4, 9, 10, number, false, 10]
an arrow function of the body reads | var a; a | [1, undefined, undefined]
an arrow function of the body reads | var a = 4; a | [1, 4, 4]
an arrow function of the body reads | function a() {} typeof a | [1, function, function]
an arrow function of the body reads | var arguments; typeof arguments | [1, undefined, 1]
an arrow function of the body reads | var arguments = 4; arguments | [1, 4, 1]
an arrow function of the body reads | { var a = 4; } a | [1, 4, 4]
an arrow function of the body reads | var a = 4; delete a | [1, true, 1]
an arrow function of the body reads | var d = 4; d | [1, 4, 1]
an arrow function of the body reads | a = 4; a | [1, 4, 4]
an arrow function of the body reads | let a = 4; a | [1, 4, 1]
an arrow function of the body reads | delete a | [1, false, 1]
an arrow function of the body reads | 'use strict'; var a = 4; a | [1, 4, 1]
the body declares var a | var a; a | [1, 1, 1]
the body declares var a | var a = 4; a | [1, 4, 4]
the body declares var a | function a() {} typeof a | [1, function, function]
the body declares var a | var arguments; typeof arguments | [1, undefined, 1]
the body declares var a | var arguments = 4; arguments | [1, 4, 1]
the body declares var a | { var a = 4; } a | [1, 4, 4]
the body declares var a | var a = 4; delete a | [1, false, 4]
the body declares var a | var d = 4; d | [1, 4, 1]
the body declares var a | a = 4; a | [1, 4, 4]
the body declares var a | let a = 4; a | [1, 4, 1]
the body declares var a | delete a | [1, false, 1]
the body declares var a | 'use strict'; var a = 4; a | [1, 4, 1]
the body declares function a | var a; a | [function, function, function]
the body declares function a | var a = 4; a | [function, 4, number]
the body declares function a | function a() {} typeof a | [function, function, function]
the body declares function a | var arguments; typeof arguments | [function, undefined, function]
the body declares function a | var arguments = 4; arguments | [function, 4, function]
the body declares function a | { var a = 4; } a | [function, 4, number]
the body declares function a | var a = 4; delete a | [function, false, number]
the body declares function a | var d = 4; d | [function, 4, function]
the body declares function a | a = 4; a | [function, 4, number]
the body declares function a | let a = 4; a | [function, 4, function]
the body declares function a | delete a | [function, false, function]
the body declares function a | 'use strict'; var a = 4; a | [function, 4, function]
arrow function | var a; a | [1, undefined, undefined]
arrow function | var a = 4; a | [1, 4, 4]
arrow function | function a() {} typeof a | [1, function, function]
arrow function | var arguments; typeof arguments | [1, undefined, 1]
arrow function | var arguments = 4; arguments | [1, 4, 1]
arrow function | { var a = 4; } a | [1, 4, 4]
arrow function | var a = 4; delete a | [1, true, 1]
arrow function | var d = 4; d | [1, 4, 1]
arrow function | a = 4; a | [1, 4, 4]
arrow function | let a = 4; a | [1, 4, 1]
arrow function | delete a | [1, false, 1]
arrow function | 'use strict'; var a = 4; a | [1, 4, 1]
arrow function whose body is an expression | var a; a | [1, undefined, undefined]
arrow function whose body is an expression | var a = 4; a | [1, 4, 4]
arrow function whose body is an expression | function a() {} typeof a | [1, function, function]
arrow function whose body is an expression | var arguments; typeof arguments | [1, undefined, 1]
arrow function whose body is an expression | var arguments = 4; arguments | [1, 4, 1]
arrow function whose body is an expression | { var a = 4; } a | [1, 4, 4]
arrow function whose body is an expression | var a = 4; delete a | [1, true, 1]
arrow function whose body is an expression | var d = 4; d | [1, 4, 1]
arrow function whose body is an expression | a = 4; a | [1, 4, 4]
arrow function whose body is an expression | let a = 4; a | [1, 4, 1]
arrow function whose body is an expression | delete a | [1, false, 1]
arrow function whose body is an expression | 'use strict'; var a = 4; a | [1, 4, 1]
method | var a; a | [1, undefined, undefined, object]
method | var a = 4; a | [1, 4, 4, object]
method | function a() {} typeof a | [1, function, function, object]
method | var arguments; typeof arguments | [1, undefined, 1, undefined]
method | var arguments = 4; arguments | [1, 4, 1, number]
method | { var a = 4; } a | [1, 4, 4, object]
method | var a = 4; delete a | [1, true, 1, object]
method | var d = 4; d | [1, 4, 1, object]
method | a = 4; a | [1, 4, 4, object]
method | let a = 4; a | [1, 4, 1, object]
method | delete a | [1, false, 1, object]
method | 'use strict'; var a = 4; a | [1, 4, 1, object]
generator | var a; a | [1, undefined, undefined, object]
generator | var a = 4; a | [1, 4, 4, object]
generator | function a() {} typeof a | [1, function, function, object]
generator | var arguments; typeof arguments | [1, undefined, 1, undefined]
generator | var arguments = 4; arguments | [1, 4, 1, number]
generator | { var a = 4; } a | [1, 4, 4, object]
generator | var a = 4; delete a | [1, true, 1, object]
generator | var d = 4; d | [1, 4, 1, object]
generator | a = 4; a | [1, 4, 4, object]
generator | let a = 4; a | [1, 4, 1, object]
generator | delete a | [1, false, 1, object]
generator | 'use strict'; var a = 4; a | [1, 4, 1, object]
async function | var a; a | [undefined, undefined, object]
async function | var a = 4; a | [4, 4, object]
async function | function a() {} typeof a | [function, function, object]
async function | var arguments; typeof arguments | [undefined, 1, undefined]
async function | var arguments = 4; arguments | [4, 1, number]
async function | { var a = 4; } a | [4, 4, object]
async function | var a = 4; delete a | [true, 1, object]
async function | var d = 4; d | [4, 1, object]
async function | a = 4; a | [4, 4, object]
async function | let a = 4; a | [4, 1, object]
async function | delete a | [false, 1, object]
async function | 'use strict'; var a = 4; a | [4, 1, object]
async generator | var a; a | [undefined, undefined, object]
async generator | var a = 4; a | [4, 4, object]
async generator | function a() {} typeof a | [function, function, object]
async generator | var arguments; typeof arguments | [undefined, 1, undefined]
async generator | var arguments = 4; arguments | [4, 1, number]
async generator | { var a = 4; } a | [4, 4, object]
async generator | var a = 4; delete a | [true, 1, object]
async generator | var d = 4; d | [4, 1, object]
async generator | a = 4; a | [4, 4, object]
async generator | let a = 4; a | [4, 1, object]
async generator | delete a | [false, 1, object]
async generator | 'use strict'; var a = 4; a | [4, 1, object]
*/
