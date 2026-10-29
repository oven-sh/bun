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
/* Output:
function | var a; a | [1, undefined, undefined, 2, object]
function | var a = 4; a | [1, 4, 4, 2, object]
function | function a() {} typeof a | [1, function, function, 2, object]
function | var b; b | [1, undefined, 1, undefined, object]
function | var arguments; typeof arguments | [1, undefined, 1, 2, undefined]
function | var arguments = 4; arguments | [1, 4, 1, 2, number]
function | function arguments() {} typeof arguments | [1, function, 1, 2, function]
function | { var a = 4; } a | [1, 4, 4, 2, object]
function | for (var a of [4]); a | [1, 4, 4, 2, object]
function | { function a() {} } typeof a | [1, function, function, 2, object]
function | var a = 4; delete a | [1, true, 1, 2, object]
function | var d = 4; d | [1, 4, 1, 2, object]
function | a = 4; a | [1, 4, 4, 2, object]
function | arguments = 4; arguments | [1, 4, 1, 2, number]
function | let a = 4; a | [1, 4, 1, 2, object]
function | delete a | [1, false, 1, 2, object]
function | (() => { var a = 4; return a; })() | [1, 4, 1, 2, object]
function | 'use strict'; var a = 4; a | [1, 4, 1, 2, object]
function, stores and deletes | var a; a | [undefined, 9, 11, number, true, 1]
function, stores and deletes | var a = 4; a | [4, 9, 11, number, true, 1]
function, stores and deletes | function a() {} typeof a | [function, 9, 11, number, true, 1]
function, stores and deletes | var b; b | [undefined, 9, 11, number, false, 11]
function, stores and deletes | var arguments; typeof arguments | [undefined, 9, 11, number, false, 11]
function, stores and deletes | var arguments = 4; arguments | [4, 9, 11, number, false, 11]
function, stores and deletes | function arguments() {} typeof arguments | [function, 9, 11, number, false, 11]
function, stores and deletes | { var a = 4; } a | [4, 9, 11, number, true, 1]
function, stores and deletes | for (var a of [4]); a | [4, 9, 11, number, true, 1]
function, stores and deletes | { function a() {} } typeof a | [function, 9, 11, number, true, 1]
function, stores and deletes | var a = 4; delete a | [true, 9, 11, number, false, 11]
function, stores and deletes | var d = 4; d | [4, 9, 11, number, false, 11]
function, stores and deletes | a = 4; a | [4, 9, 11, number, false, 11]
function, stores and deletes | arguments = 4; arguments | [4, 9, 11, number, false, 11]
function, stores and deletes | let a = 4; a | [4, 9, 11, number, false, 11]
function, stores and deletes | delete a | [false, 9, 11, number, false, 11]
function, stores and deletes | (() => { var a = 4; return a; })() | [4, 9, 11, number, false, 11]
function, stores and deletes | 'use strict'; var a = 4; a | [4, 9, 11, number, false, 11]
function, stores through patterns | var a; a | [undefined, 9, 8, 7, true, 1]
function, stores through patterns | var a = 4; a | [4, 9, 8, 7, true, 1]
function, stores through patterns | function a() {} typeof a | [function, 9, 8, 7, true, 1]
function, stores through patterns | var b; b | [undefined, 9, 8, 7, false, 7]
function, stores through patterns | var arguments; typeof arguments | [undefined, 9, 8, 7, false, 7]
function, stores through patterns | var arguments = 4; arguments | [4, 9, 8, 7, false, 7]
function, stores through patterns | function arguments() {} typeof arguments | [function, 9, 8, 7, false, 7]
function, stores through patterns | { var a = 4; } a | [4, 9, 8, 7, true, 1]
function, stores through patterns | for (var a of [4]); a | [4, 9, 8, 7, true, 1]
function, stores through patterns | { function a() {} } typeof a | [function, 9, 8, 7, true, 1]
function, stores through patterns | var a = 4; delete a | [true, 9, 8, 7, false, 7]
function, stores through patterns | var d = 4; d | [4, 9, 8, 7, false, 7]
function, stores through patterns | a = 4; a | [4, 9, 8, 7, false, 7]
function, stores through patterns | arguments = 4; arguments | [4, 9, 8, 7, false, 7]
function, stores through patterns | let a = 4; a | [4, 9, 8, 7, false, 7]
function, stores through patterns | delete a | [false, 9, 8, 7, false, 7]
function, stores through patterns | (() => { var a = 4; return a; })() | [4, 9, 8, 7, false, 7]
function, stores through patterns | 'use strict'; var a = 4; a | [4, 9, 8, 7, false, 7]
function, calls | var a; a | [undefined, no function]
function, calls | var a = 4; a | [4, no function]
function, calls | function a() {} typeof a | [function, undefined]
function, calls | var b; b | [undefined, number]
function, calls | var arguments; typeof arguments | [undefined, number]
function, calls | var arguments = 4; arguments | [4, number]
function, calls | function arguments() {} typeof arguments | [function, number]
function, calls | { var a = 4; } a | [4, no function]
function, calls | for (var a of [4]); a | [4, no function]
function, calls | { function a() {} } typeof a | [function, undefined]
function, calls | var a = 4; delete a | [true, number]
function, calls | var d = 4; d | [4, number]
function, calls | a = 4; a | [4, no function]
function, calls | arguments = 4; arguments | [4, number]
function, calls | let a = 4; a | [4, number]
function, calls | delete a | [false, number]
function, calls | (() => { var a = 4; return a; })() | [4, number]
function, calls | 'use strict'; var a = 4; a | [4, number]
function, deletes arguments | var a; a | [undefined, object, false, object]
function, deletes arguments | var a = 4; a | [4, object, false, object]
function, deletes arguments | function a() {} typeof a | [function, object, false, object]
function, deletes arguments | var b; b | [undefined, object, false, object]
function, deletes arguments | var arguments; typeof arguments | [undefined, undefined, true, object]
function, deletes arguments | var arguments = 4; arguments | [4, number, true, object]
function, deletes arguments | function arguments() {} typeof arguments | [function, function, true, object]
function, deletes arguments | { var a = 4; } a | [4, object, false, object]
function, deletes arguments | for (var a of [4]); a | [4, object, false, object]
function, deletes arguments | { function a() {} } typeof a | [function, object, false, object]
function, deletes arguments | var a = 4; delete a | [true, object, false, object]
function, deletes arguments | var d = 4; d | [4, object, false, object]
function, deletes arguments | a = 4; a | [4, object, false, object]
function, deletes arguments | arguments = 4; arguments | [4, number, false, number]
function, deletes arguments | let a = 4; a | [4, object, false, object]
function, deletes arguments | delete a | [false, object, false, object]
function, deletes arguments | (() => { var a = 4; return a; })() | [4, object, false, object]
function, deletes arguments | 'use strict'; var a = 4; a | [4, object, false, object]
an arrow function of the body reads | var a; a | [[1, object], undefined, [undefined, object]]
an arrow function of the body reads | var a = 4; a | [[1, object], 4, [4, object]]
an arrow function of the body reads | function a() {} typeof a | [[1, object], function, [function, object]]
an arrow function of the body reads | var b; b | [[1, object], undefined, [1, object]]
an arrow function of the body reads | var arguments; typeof arguments | [[1, object], undefined, [1, undefined]]
an arrow function of the body reads | var arguments = 4; arguments | [[1, object], 4, [1, number]]
an arrow function of the body reads | function arguments() {} typeof arguments | [[1, object], function, [1, function]]
an arrow function of the body reads | { var a = 4; } a | [[1, object], 4, [4, object]]
an arrow function of the body reads | for (var a of [4]); a | [[1, object], 4, [4, object]]
an arrow function of the body reads | { function a() {} } typeof a | [[1, object], function, [function, object]]
an arrow function of the body reads | var a = 4; delete a | [[1, object], true, [1, object]]
an arrow function of the body reads | var d = 4; d | [[1, object], 4, [1, object]]
an arrow function of the body reads | a = 4; a | [[1, object], 4, [4, object]]
an arrow function of the body reads | arguments = 4; arguments | [[1, object], 4, [1, number]]
an arrow function of the body reads | let a = 4; a | [[1, object], 4, [1, object]]
an arrow function of the body reads | delete a | [[1, object], false, [1, object]]
an arrow function of the body reads | (() => { var a = 4; return a; })() | [[1, object], 4, [1, object]]
an arrow function of the body reads | 'use strict'; var a = 4; a | [[1, object], 4, [1, object]]
an arrow function of the body stores | var a; a | [undefined, 9, true, 1]
an arrow function of the body stores | var a = 4; a | [4, 9, true, 1]
an arrow function of the body stores | function a() {} typeof a | [function, 9, true, 1]
an arrow function of the body stores | var b; b | [undefined, 9, false, 9]
an arrow function of the body stores | var arguments; typeof arguments | [undefined, 9, false, 9]
an arrow function of the body stores | var arguments = 4; arguments | [4, 9, false, 9]
an arrow function of the body stores | function arguments() {} typeof arguments | [function, 9, false, 9]
an arrow function of the body stores | { var a = 4; } a | [4, 9, true, 1]
an arrow function of the body stores | for (var a of [4]); a | [4, 9, true, 1]
an arrow function of the body stores | { function a() {} } typeof a | [function, 9, true, 1]
an arrow function of the body stores | var a = 4; delete a | [true, 9, false, 9]
an arrow function of the body stores | var d = 4; d | [4, 9, false, 9]
an arrow function of the body stores | a = 4; a | [4, 9, false, 9]
an arrow function of the body stores | arguments = 4; arguments | [4, 9, false, 9]
an arrow function of the body stores | let a = 4; a | [4, 9, false, 9]
an arrow function of the body stores | delete a | [false, 9, false, 9]
an arrow function of the body stores | (() => { var a = 4; return a; })() | [4, 9, false, 9]
an arrow function of the body stores | 'use strict'; var a = 4; a | [4, 9, false, 9]
an arrow function of the parameters reads | var a; a | [undefined, undefined, [1, object]]
an arrow function of the parameters reads | var a = 4; a | [4, 4, [1, object]]
an arrow function of the parameters reads | function a() {} typeof a | [function, function, [1, object]]
an arrow function of the parameters reads | var b; b | TypeError
an arrow function of the parameters reads | var arguments; typeof arguments | [undefined, 1, [1, object]]
an arrow function of the parameters reads | var arguments = 4; arguments | [4, 1, [1, object]]
an arrow function of the parameters reads | function arguments() {} typeof arguments | [function, 1, [1, object]]
an arrow function of the parameters reads | { var a = 4; } a | [4, 4, [1, object]]
an arrow function of the parameters reads | for (var a of [4]); a | [4, 4, [1, object]]
an arrow function of the parameters reads | { function a() {} } typeof a | [function, function, [1, object]]
an arrow function of the parameters reads | var a = 4; delete a | [true, 1, [1, object]]
an arrow function of the parameters reads | var d = 4; d | [4, 1, [1, object]]
an arrow function of the parameters reads | a = 4; a | [4, 4, [4, object]]
an arrow function of the parameters reads | arguments = 4; arguments | [4, 1, [1, number]]
an arrow function of the parameters reads | let a = 4; a | [4, 1, [1, object]]
an arrow function of the parameters reads | delete a | [false, 1, [1, object]]
an arrow function of the parameters reads | (() => { var a = 4; return a; })() | [4, 1, [1, object]]
an arrow function of the parameters reads | 'use strict'; var a = 4; a | [4, 1, [1, object]]
an arrow function of the parameters stores | var a; a | [undefined, undefined, true, 9]
an arrow function of the parameters stores | var a = 4; a | [4, 4, true, 9]
an arrow function of the parameters stores | function a() {} typeof a | [function, function, true, 9]
an arrow function of the parameters stores | var b; b | TypeError
an arrow function of the parameters stores | var arguments; typeof arguments | [undefined, 9, false, 9]
an arrow function of the parameters stores | var arguments = 4; arguments | [4, 9, false, 9]
an arrow function of the parameters stores | function arguments() {} typeof arguments | [function, 9, false, 9]
an arrow function of the parameters stores | { var a = 4; } a | [4, 4, true, 9]
an arrow function of the parameters stores | for (var a of [4]); a | [4, 4, true, 9]
an arrow function of the parameters stores | { function a() {} } typeof a | [function, function, true, 9]
an arrow function of the parameters stores | var a = 4; delete a | [true, 9, false, 9]
an arrow function of the parameters stores | var d = 4; d | [4, 9, false, 9]
an arrow function of the parameters stores | a = 4; a | [4, 9, false, 9]
an arrow function of the parameters stores | arguments = 4; arguments | [4, 9, false, 9]
an arrow function of the parameters stores | let a = 4; a | [4, 9, false, 9]
an arrow function of the parameters stores | delete a | [false, 9, false, 9]
an arrow function of the parameters stores | (() => { var a = 4; return a; })() | [4, 9, false, 9]
an arrow function of the parameters stores | 'use strict'; var a = 4; a | [4, 9, false, 9]
the body declares var a | var a; a | [1, 1, 1]
the body declares var a | var a = 4; a | [4, 4, 1]
the body declares var a | function a() {} typeof a | [function, function, 1]
the body declares var a | var b; b | TypeError
the body declares var a | var arguments; typeof arguments | [undefined, 1, 1]
the body declares var a | var arguments = 4; arguments | [4, 1, 1]
the body declares var a | function arguments() {} typeof arguments | [function, 1, 1]
the body declares var a | { var a = 4; } a | [4, 4, 1]
the body declares var a | for (var a of [4]); a | [4, 4, 1]
the body declares var a | { function a() {} } typeof a | [function, function, 1]
the body declares var a | var a = 4; delete a | [false, 4, 1]
the body declares var a | var d = 4; d | [4, 1, 1]
the body declares var a | a = 4; a | [4, 4, 1]
the body declares var a | arguments = 4; arguments | [4, 1, 1]
the body declares var a | let a = 4; a | [4, 1, 1]
the body declares var a | delete a | [false, 1, 1]
the body declares var a | (() => { var a = 4; return a; })() | [4, 1, 1]
the body declares var a | 'use strict'; var a = 4; a | [4, 1, 1]
the body declares function a | var a; a | [function, function, 1]
the body declares function a | var a = 4; a | [4, number, 1]
the body declares function a | function a() {} typeof a | [function, function, 1]
the body declares function a | var b; b | TypeError
the body declares function a | var arguments; typeof arguments | [undefined, function, 1]
the body declares function a | var arguments = 4; arguments | [4, function, 1]
the body declares function a | function arguments() {} typeof arguments | [function, function, 1]
the body declares function a | { var a = 4; } a | [4, number, 1]
the body declares function a | for (var a of [4]); a | [4, number, 1]
the body declares function a | { function a() {} } typeof a | [function, function, 1]
the body declares function a | var a = 4; delete a | [false, number, 1]
the body declares function a | var d = 4; d | [4, function, 1]
the body declares function a | a = 4; a | [4, number, 1]
the body declares function a | arguments = 4; arguments | [4, function, 1]
the body declares function a | let a = 4; a | [4, function, 1]
the body declares function a | delete a | [false, function, 1]
the body declares function a | (() => { var a = 4; return a; })() | [4, function, 1]
the body declares function a | 'use strict'; var a = 4; a | [4, function, 1]
the body declares var arguments | var a; a | [undefined, undefined, object]
the body declares var arguments | var a = 4; a | [4, 4, object]
the body declares var arguments | function a() {} typeof a | [function, function, object]
the body declares var arguments | var b; b | [undefined, 1, object]
the body declares var arguments | var arguments; typeof arguments | [object, 1, object]
the body declares var arguments | var arguments = 4; arguments | [4, 1, number]
the body declares var arguments | function arguments() {} typeof arguments | [function, 1, function]
the body declares var arguments | { var a = 4; } a | [4, 4, object]
the body declares var arguments | for (var a of [4]); a | [4, 4, object]
the body declares var arguments | { function a() {} } typeof a | [function, function, object]
the body declares var arguments | var a = 4; delete a | [true, 1, object]
the body declares var arguments | var d = 4; d | [4, 1, object]
the body declares var arguments | a = 4; a | [4, 4, object]
the body declares var arguments | arguments = 4; arguments | [4, 1, number]
the body declares var arguments | let a = 4; a | [4, 1, object]
the body declares var arguments | delete a | [false, 1, object]
the body declares var arguments | (() => { var a = 4; return a; })() | [4, 1, object]
the body declares var arguments | 'use strict'; var a = 4; a | [4, 1, object]
the body declares var d | var a; a | [undefined, undefined, 7]
the body declares var d | var a = 4; a | [4, 4, 7]
the body declares var d | function a() {} typeof a | [function, function, 7]
the body declares var d | var b; b | [undefined, 1, 7]
the body declares var d | var arguments; typeof arguments | [undefined, 1, 7]
the body declares var d | var arguments = 4; arguments | [4, 1, 7]
the body declares var d | function arguments() {} typeof arguments | [function, 1, 7]
the body declares var d | { var a = 4; } a | [4, 4, 7]
the body declares var d | for (var a of [4]); a | [4, 4, 7]
the body declares var d | { function a() {} } typeof a | [function, function, 7]
the body declares var d | var a = 4; delete a | [true, 1, 7]
the body declares var d | var d = 4; d | [4, 1, 4]
the body declares var d | a = 4; a | [4, 4, 7]
the body declares var d | arguments = 4; arguments | [4, 1, 7]
the body declares var d | let a = 4; a | [4, 1, 7]
the body declares var d | delete a | [false, 1, 7]
the body declares var d | (() => { var a = 4; return a; })() | [4, 1, 7]
the body declares var d | 'use strict'; var a = 4; a | [4, 1, 7]
the body declares let d | var a; a | [undefined, undefined, 7]
the body declares let d | var a = 4; a | [4, 4, 7]
the body declares let d | function a() {} typeof a | [function, function, 7]
the body declares let d | var b; b | [undefined, 1, 7]
the body declares let d | var arguments; typeof arguments | [undefined, 1, 7]
the body declares let d | var arguments = 4; arguments | [4, 1, 7]
the body declares let d | function arguments() {} typeof arguments | [function, 1, 7]
the body declares let d | { var a = 4; } a | [4, 4, 7]
the body declares let d | for (var a of [4]); a | [4, 4, 7]
the body declares let d | { function a() {} } typeof a | [function, function, 7]
the body declares let d | var a = 4; delete a | [true, 1, 7]
the body declares let d | var d = 4; d | SyntaxError
the body declares let d | a = 4; a | [4, 4, 7]
the body declares let d | arguments = 4; arguments | [4, 1, 7]
the body declares let d | let a = 4; a | [4, 1, 7]
the body declares let d | delete a | [false, 1, 7]
the body declares let d | (() => { var a = 4; return a; })() | [4, 1, 7]
the body declares let d | 'use strict'; var a = 4; a | [4, 1, 7]
two texts | var a; a | [undefined, [undefined, object], undefined, undefined]
two texts | var a = 4; a | [4, [4, object], 4, 4]
two texts | function a() {} typeof a | [function, [function, object], function, function]
two texts | var b; b | [undefined, [1, object], undefined, undefined]
two texts | var arguments; typeof arguments | [undefined, [1, undefined], undefined, undefined]
two texts | var arguments = 4; arguments | [4, [1, number], undefined, undefined]
two texts | function arguments() {} typeof arguments | [function, [1, function], undefined, undefined]
two texts | { var a = 4; } a | [4, [4, object], 4, 4]
two texts | for (var a of [4]); a | [4, [4, object], 4, 4]
two texts | { function a() {} } typeof a | [function, [function, object], function, function]
two texts | var a = 4; delete a | [true, [1, object], undefined, undefined]
two texts | var d = 4; d | [4, [1, object], undefined, undefined]
two texts | a = 4; a | [4, [4, object], undefined, undefined]
two texts | arguments = 4; arguments | [4, [1, number], undefined, undefined]
two texts | let a = 4; a | [4, [1, object], undefined, undefined]
two texts | delete a | [false, [1, object], undefined, undefined]
two texts | (() => { var a = 4; return a; })() | [4, [1, object], undefined, undefined]
two texts | 'use strict'; var a = 4; a | [4, [1, object], undefined, undefined]
in a block | var a; a | [undefined, undefined]
in a block | var a = 4; a | [4, 4]
in a block | function a() {} typeof a | [function, function]
in a block | var b; b | [undefined, 1]
in a block | var arguments; typeof arguments | [undefined, 1]
in a block | var arguments = 4; arguments | [4, 1]
in a block | function arguments() {} typeof arguments | [function, 1]
in a block | { var a = 4; } a | [4, 4]
in a block | for (var a of [4]); a | [4, 4]
in a block | { function a() {} } typeof a | [function, function]
in a block | var a = 4; delete a | [true, 1]
in a block | var d = 4; d | [4, 1]
in a block | a = 4; a | [4, 4]
in a block | arguments = 4; arguments | [4, 1]
in a block | let a = 4; a | [4, 1]
in a block | delete a | [false, 1]
in a block | (() => { var a = 4; return a; })() | [4, 1]
in a block | 'use strict'; var a = 4; a | [4, 1]
in a with statement | var a; a | [undefined, undefined, object]
in a with statement | var a = 4; a | [4, 4, object]
in a with statement | function a() {} typeof a | [function, function, object]
in a with statement | var b; b | [undefined, 1, object]
in a with statement | var arguments; typeof arguments | [undefined, 1, undefined]
in a with statement | var arguments = 4; arguments | [4, 1, number]
in a with statement | function arguments() {} typeof arguments | [function, 1, function]
in a with statement | { var a = 4; } a | [4, 4, object]
in a with statement | for (var a of [4]); a | [4, 4, object]
in a with statement | { function a() {} } typeof a | [function, function, object]
in a with statement | var a = 4; delete a | [true, 1, object]
in a with statement | var d = 4; d | [4, 1, object]
in a with statement | a = 4; a | [4, 4, object]
in a with statement | arguments = 4; arguments | [4, 1, number]
in a with statement | let a = 4; a | [4, 1, object]
in a with statement | delete a | [false, 1, object]
in a with statement | (() => { var a = 4; return a; })() | [4, 1, object]
in a with statement | 'use strict'; var a = 4; a | [4, 1, object]
before a with statement | var a; a | [undefined, undefined, 3, object]
before a with statement | var a = 4; a | [4, 4, 3, object]
before a with statement | function a() {} typeof a | [function, function, 3, object]
before a with statement | var b; b | [undefined, 1, 3, object]
before a with statement | var arguments; typeof arguments | [undefined, 1, 3, undefined]
before a with statement | var arguments = 4; arguments | [4, 1, 3, number]
before a with statement | function arguments() {} typeof arguments | [function, 1, 3, function]
before a with statement | { var a = 4; } a | [4, 4, 3, object]
before a with statement | for (var a of [4]); a | [4, 4, 3, object]
before a with statement | { function a() {} } typeof a | [function, function, 3, object]
before a with statement | var a = 4; delete a | [true, 1, 3, object]
before a with statement | var d = 4; d | [4, 1, 3, object]
before a with statement | a = 4; a | [4, 4, 3, object]
before a with statement | arguments = 4; arguments | [4, 1, 3, number]
before a with statement | let a = 4; a | [4, 1, 3, object]
before a with statement | delete a | [false, 1, 3, object]
before a with statement | (() => { var a = 4; return a; })() | [4, 1, 3, object]
before a with statement | 'use strict'; var a = 4; a | [4, 1, 3, object]
in an arrow function of the body | var a; a | [[undefined, undefined, object], 1, object]
in an arrow function of the body | var a = 4; a | [[4, 4, object], 1, object]
in an arrow function of the body | function a() {} typeof a | [[function, function, object], 1, object]
in an arrow function of the body | var b; b | [[undefined, 1, object], 1, object]
in an arrow function of the body | var arguments; typeof arguments | [[undefined, 1, undefined], 1, object]
in an arrow function of the body | var arguments = 4; arguments | [[4, 1, number], 1, object]
in an arrow function of the body | function arguments() {} typeof arguments | [[function, 1, function], 1, object]
in an arrow function of the body | { var a = 4; } a | [[4, 4, object], 1, object]
in an arrow function of the body | for (var a of [4]); a | [[4, 4, object], 1, object]
in an arrow function of the body | { function a() {} } typeof a | [[function, function, object], 1, object]
in an arrow function of the body | var a = 4; delete a | [[true, 1, object], 1, object]
in an arrow function of the body | var d = 4; d | [[4, 1, object], 1, object]
in an arrow function of the body | a = 4; a | [[4, 4, object], 4, object]
in an arrow function of the body | arguments = 4; arguments | [[4, 1, number], 1, number]
in an arrow function of the body | let a = 4; a | [[4, 1, object], 1, object]
in an arrow function of the body | delete a | [[false, 1, object], 1, object]
in an arrow function of the body | (() => { var a = 4; return a; })() | [[4, 1, object], 1, object]
in an arrow function of the body | 'use strict'; var a = 4; a | [[4, 1, object], 1, object]
in an arrow function of the body, behind a text of the body | var a; a | [[undefined, undefined], 6]
in an arrow function of the body, behind a text of the body | var a = 4; a | [[4, 4], 6]
in an arrow function of the body, behind a text of the body | function a() {} typeof a | [[function, function], 6]
in an arrow function of the body, behind a text of the body | var b; b | [[undefined, 6], 6]
in an arrow function of the body, behind a text of the body | var arguments; typeof arguments | [[undefined, 6], 6]
in an arrow function of the body, behind a text of the body | var arguments = 4; arguments | [[4, 6], 6]
in an arrow function of the body, behind a text of the body | function arguments() {} typeof arguments | [[function, 6], 6]
in an arrow function of the body, behind a text of the body | { var a = 4; } a | [[4, 4], 6]
in an arrow function of the body, behind a text of the body | for (var a of [4]); a | [[4, 4], 6]
in an arrow function of the body, behind a text of the body | { function a() {} } typeof a | [[function, function], 6]
in an arrow function of the body, behind a text of the body | var a = 4; delete a | [[true, 6], 6]
in an arrow function of the body, behind a text of the body | var d = 4; d | [[4, 6], 6]
in an arrow function of the body, behind a text of the body | a = 4; a | [[4, 4], 4]
in an arrow function of the body, behind a text of the body | arguments = 4; arguments | [[4, 6], 6]
in an arrow function of the body, behind a text of the body | let a = 4; a | [[4, 6], 6]
in an arrow function of the body, behind a text of the body | delete a | [[true, 1], 1]
in an arrow function of the body, behind a text of the body | (() => { var a = 4; return a; })() | [[4, 6], 6]
in an arrow function of the body, behind a text of the body | 'use strict'; var a = 4; a | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | var a; a | [[undefined, 6], 6]
in a method of a class of the body, behind a text of the body | var a = 4; a | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | function a() {} typeof a | [[function, 6], 6]
in a method of a class of the body, behind a text of the body | var b; b | [[undefined, 6], 6]
in a method of a class of the body, behind a text of the body | var arguments; typeof arguments | SyntaxError
in a method of a class of the body, behind a text of the body | var arguments = 4; arguments | SyntaxError
in a method of a class of the body, behind a text of the body | function arguments() {} typeof arguments | SyntaxError
in a method of a class of the body, behind a text of the body | { var a = 4; } a | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | for (var a of [4]); a | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | { function a() {} } typeof a | [[number, 6], 6]
in a method of a class of the body, behind a text of the body | var a = 4; delete a | SyntaxError
in a method of a class of the body, behind a text of the body | var d = 4; d | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | a = 4; a | [[4, 4], 4]
in a method of a class of the body, behind a text of the body | arguments = 4; arguments | SyntaxError
in a method of a class of the body, behind a text of the body | let a = 4; a | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | delete a | SyntaxError
in a method of a class of the body, behind a text of the body | (() => { var a = 4; return a; })() | [[4, 6], 6]
in a method of a class of the body, behind a text of the body | 'use strict'; var a = 4; a | [[4, 6], 6]
a pattern with a default | var a; a | [undefined, undefined, object]
a pattern with a default | var a = 4; a | [4, 4, object]
a pattern with a default | function a() {} typeof a | [function, function, object]
a pattern with a default | var b; b | [undefined, 1, object]
a pattern with a default | var arguments; typeof arguments | [undefined, 1, undefined]
a pattern with a default | var arguments = 4; arguments | [4, 1, number]
a pattern with a default | function arguments() {} typeof arguments | [function, 1, function]
a pattern with a default | { var a = 4; } a | [4, 4, object]
a pattern with a default | for (var a of [4]); a | [4, 4, object]
a pattern with a default | { function a() {} } typeof a | [function, function, object]
a pattern with a default | var a = 4; delete a | [true, 1, object]
a pattern with a default | var d = 4; d | [4, 1, object]
a pattern with a default | a = 4; a | [4, 4, object]
a pattern with a default | arguments = 4; arguments | [4, 1, number]
a pattern with a default | let a = 4; a | [4, 1, object]
a pattern with a default | delete a | [false, 1, object]
a pattern with a default | (() => { var a = 4; return a; })() | [4, 1, object]
a pattern with a default | 'use strict'; var a = 4; a | [4, 1, object]
a pattern with a computed key | var a; a | [undefined, undefined, object]
a pattern with a computed key | var a = 4; a | [4, 4, object]
a pattern with a computed key | function a() {} typeof a | [function, function, object]
a pattern with a computed key | var b; b | [undefined, 1, object]
a pattern with a computed key | var arguments; typeof arguments | [undefined, 1, undefined]
a pattern with a computed key | var arguments = 4; arguments | [4, 1, number]
a pattern with a computed key | function arguments() {} typeof arguments | [function, 1, function]
a pattern with a computed key | { var a = 4; } a | [4, 4, object]
a pattern with a computed key | for (var a of [4]); a | [4, 4, object]
a pattern with a computed key | { function a() {} } typeof a | [function, function, object]
a pattern with a computed key | var a = 4; delete a | [true, 1, object]
a pattern with a computed key | var d = 4; d | [4, 1, object]
a pattern with a computed key | a = 4; a | [4, 4, object]
a pattern with a computed key | arguments = 4; arguments | [4, 1, number]
a pattern with a computed key | let a = 4; a | [4, 1, object]
a pattern with a computed key | delete a | [false, 1, object]
a pattern with a computed key | (() => { var a = 4; return a; })() | [4, 1, object]
a pattern with a computed key | 'use strict'; var a = 4; a | [4, 1, object]
a default and a rest | var a; a | [undefined, undefined, object]
a default and a rest | var a = 4; a | [4, 4, object]
a default and a rest | function a() {} typeof a | [function, function a() {}, object]
a default and a rest | var b; b | [undefined, 1, object]
a default and a rest | var arguments; typeof arguments | [undefined, 1, undefined]
a default and a rest | var arguments = 4; arguments | [4, 1, number]
a default and a rest | function arguments() {} typeof arguments | [function, 1, function]
a default and a rest | { var a = 4; } a | [4, 4, object]
a default and a rest | for (var a of [4]); a | [4, 4, object]
a default and a rest | { function a() {} } typeof a | [function, function a() {}, object]
a default and a rest | var a = 4; delete a | [true, 1, object]
a default and a rest | var d = 4; d | [4, 1, object]
a default and a rest | a = 4; a | [4, 4, object]
a default and a rest | arguments = 4; arguments | [4, 1, number]
a default and a rest | let a = 4; a | [4, 1, object]
a default and a rest | delete a | [false, 1, object]
a default and a rest | (() => { var a = 4; return a; })() | [4, 1, object]
a default and a rest | 'use strict'; var a = 4; a | [4, 1, object]
a parameter named arguments | var a; a | [undefined, undefined, 5]
a parameter named arguments | var a = 4; a | [4, 4, 5]
a parameter named arguments | function a() {} typeof a | [function, function, 5]
a parameter named arguments | var b; b | [undefined, 1, 5]
a parameter named arguments | var arguments; typeof arguments | [undefined, 1, undefined]
a parameter named arguments | var arguments = 4; arguments | [4, 1, 4]
a parameter named arguments | function arguments() {} typeof arguments | [function, 1, function]
a parameter named arguments | { var a = 4; } a | [4, 4, 5]
a parameter named arguments | for (var a of [4]); a | [4, 4, 5]
a parameter named arguments | { function a() {} } typeof a | [function, function, 5]
a parameter named arguments | var a = 4; delete a | [true, 1, 5]
a parameter named arguments | var d = 4; d | [4, 1, 5]
a parameter named arguments | a = 4; a | [4, 4, 5]
a parameter named arguments | arguments = 4; arguments | [4, 1, 4]
a parameter named arguments | let a = 4; a | [4, 1, 5]
a parameter named arguments | delete a | [false, 1, 5]
a parameter named arguments | (() => { var a = 4; return a; })() | [4, 1, 5]
a parameter named arguments | 'use strict'; var a = 4; a | [4, 1, 5]
arrow function | var a; a | [1, undefined, undefined, 2]
arrow function | var a = 4; a | [1, 4, 4, 2]
arrow function | function a() {} typeof a | [1, function, function, 2]
arrow function | var b; b | [1, undefined, 1, undefined]
arrow function | var arguments; typeof arguments | [1, undefined, 1, 2]
arrow function | var arguments = 4; arguments | [1, 4, 1, 2]
arrow function | function arguments() {} typeof arguments | [1, function, 1, 2]
arrow function | { var a = 4; } a | [1, 4, 4, 2]
arrow function | for (var a of [4]); a | [1, 4, 4, 2]
arrow function | { function a() {} } typeof a | [1, function, function, 2]
arrow function | var a = 4; delete a | [1, true, 1, 2]
arrow function | var d = 4; d | [1, 4, 1, 2]
arrow function | a = 4; a | [1, 4, 4, 2]
arrow function | arguments = 4; arguments | [1, 4, 1, 2]
arrow function | let a = 4; a | [1, 4, 1, 2]
arrow function | delete a | [1, false, 1, 2]
arrow function | (() => { var a = 4; return a; })() | [1, 4, 1, 2]
arrow function | 'use strict'; var a = 4; a | [1, 4, 1, 2]
arrow function whose body is an expression | var a; a | [1, undefined, undefined, 2]
arrow function whose body is an expression | var a = 4; a | [1, 4, 4, 2]
arrow function whose body is an expression | function a() {} typeof a | [1, function, function, 2]
arrow function whose body is an expression | var b; b | [1, undefined, 1, undefined]
arrow function whose body is an expression | var arguments; typeof arguments | [1, undefined, 1, 2]
arrow function whose body is an expression | var arguments = 4; arguments | [1, 4, 1, 2]
arrow function whose body is an expression | function arguments() {} typeof arguments | [1, function, 1, 2]
arrow function whose body is an expression | { var a = 4; } a | [1, 4, 4, 2]
arrow function whose body is an expression | for (var a of [4]); a | [1, 4, 4, 2]
arrow function whose body is an expression | { function a() {} } typeof a | [1, function, function, 2]
arrow function whose body is an expression | var a = 4; delete a | [1, true, 1, 2]
arrow function whose body is an expression | var d = 4; d | [1, 4, 1, 2]
arrow function whose body is an expression | a = 4; a | [1, 4, 4, 2]
arrow function whose body is an expression | arguments = 4; arguments | [1, 4, 1, 2]
arrow function whose body is an expression | let a = 4; a | [1, 4, 1, 2]
arrow function whose body is an expression | delete a | [1, false, 1, 2]
arrow function whose body is an expression | (() => { var a = 4; return a; })() | [1, 4, 1, 2]
arrow function whose body is an expression | 'use strict'; var a = 4; a | [1, 4, 1, 2]
arrow function whose body is an expression, an arrow function of the parameters reads | var a; a | [undefined, undefined, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var a = 4; a | [4, 4, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | function a() {} typeof a | [function, function, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var b; b | TypeError
arrow function whose body is an expression, an arrow function of the parameters reads | var arguments; typeof arguments | [undefined, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var arguments = 4; arguments | [4, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | function arguments() {} typeof arguments | [function, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | { var a = 4; } a | [4, 4, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | for (var a of [4]); a | [4, 4, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | { function a() {} } typeof a | [function, function, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var a = 4; delete a | [true, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | var d = 4; d | [4, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | a = 4; a | [4, 4, 4]
arrow function whose body is an expression, an arrow function of the parameters reads | arguments = 4; arguments | [4, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | let a = 4; a | [4, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | delete a | [false, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | (() => { var a = 4; return a; })() | [4, 1, 1]
arrow function whose body is an expression, an arrow function of the parameters reads | 'use strict'; var a = 4; a | [4, 1, 1]
method | var a; a | [undefined, undefined, object]
method | var a = 4; a | [4, 4, object]
method | function a() {} typeof a | [function, function, object]
method | var b; b | [undefined, 1, object]
method | var arguments; typeof arguments | [undefined, 1, undefined]
method | var arguments = 4; arguments | [4, 1, number]
method | function arguments() {} typeof arguments | [function, 1, function]
method | { var a = 4; } a | [4, 4, object]
method | for (var a of [4]); a | [4, 4, object]
method | { function a() {} } typeof a | [function, function, object]
method | var a = 4; delete a | [true, 1, object]
method | var d = 4; d | [4, 1, object]
method | a = 4; a | [4, 4, object]
method | arguments = 4; arguments | [4, 1, number]
method | let a = 4; a | [4, 1, object]
method | delete a | [false, 1, object]
method | (() => { var a = 4; return a; })() | [4, 1, object]
method | 'use strict'; var a = 4; a | [4, 1, object]
setter | var a; a | [undefined, undefined, object]
setter | var a = 4; a | [4, 4, object]
setter | function a() {} typeof a | [function, function, object]
setter | var b; b | [undefined, 1, object]
setter | var arguments; typeof arguments | [undefined, 1, undefined]
setter | var arguments = 4; arguments | [4, 1, number]
setter | function arguments() {} typeof arguments | [function, 1, function]
setter | { var a = 4; } a | [4, 4, object]
setter | for (var a of [4]); a | [4, 4, object]
setter | { function a() {} } typeof a | [function, function, object]
setter | var a = 4; delete a | [true, 1, object]
setter | var d = 4; d | [4, 1, object]
setter | a = 4; a | [4, 4, object]
setter | arguments = 4; arguments | [4, 1, number]
setter | let a = 4; a | [4, 1, object]
setter | delete a | [false, 1, object]
setter | (() => { var a = 4; return a; })() | [4, 1, object]
setter | 'use strict'; var a = 4; a | [4, 1, object]
generator | var a; a | [undefined, undefined, object]
generator | var a = 4; a | [4, 4, object]
generator | function a() {} typeof a | [function, function, object]
generator | var b; b | [undefined, 1, object]
generator | var arguments; typeof arguments | [undefined, 1, undefined]
generator | var arguments = 4; arguments | [4, 1, number]
generator | function arguments() {} typeof arguments | [function, 1, function]
generator | { var a = 4; } a | [4, 4, object]
generator | for (var a of [4]); a | [4, 4, object]
generator | { function a() {} } typeof a | [function, function, object]
generator | var a = 4; delete a | [true, 1, object]
generator | var d = 4; d | [4, 1, object]
generator | a = 4; a | [4, 4, object]
generator | arguments = 4; arguments | [4, 1, number]
generator | let a = 4; a | [4, 1, object]
generator | delete a | [false, 1, object]
generator | (() => { var a = 4; return a; })() | [4, 1, object]
generator | 'use strict'; var a = 4; a | [4, 1, object]
generator, behind a yield | var a; a | [undefined, undefined, object]
generator, behind a yield | var a = 4; a | [4, 4, object]
generator, behind a yield | function a() {} typeof a | [function, function, object]
generator, behind a yield | var b; b | [undefined, 1, object]
generator, behind a yield | var arguments; typeof arguments | [undefined, 1, undefined]
generator, behind a yield | var arguments = 4; arguments | [4, 1, number]
generator, behind a yield | function arguments() {} typeof arguments | [function, 1, function]
generator, behind a yield | { var a = 4; } a | [4, 4, object]
generator, behind a yield | for (var a of [4]); a | [4, 4, object]
generator, behind a yield | { function a() {} } typeof a | [function, function, object]
generator, behind a yield | var a = 4; delete a | [true, 1, object]
generator, behind a yield | var d = 4; d | [4, 1, object]
generator, behind a yield | a = 4; a | [4, 4, object]
generator, behind a yield | arguments = 4; arguments | [4, 1, number]
generator, behind a yield | let a = 4; a | [4, 1, object]
generator, behind a yield | delete a | [false, 1, object]
generator, behind a yield | (() => { var a = 4; return a; })() | [4, 1, object]
generator, behind a yield | 'use strict'; var a = 4; a | [4, 1, object]
async function | var a; a | [undefined, undefined, object]
async function | var a = 4; a | [4, 4, object]
async function | function a() {} typeof a | [function, function, object]
async function | var b; b | [undefined, 1, object]
async function | var arguments; typeof arguments | [undefined, 1, undefined]
async function | var arguments = 4; arguments | [4, 1, number]
async function | function arguments() {} typeof arguments | [function, 1, function]
async function | { var a = 4; } a | [4, 4, object]
async function | for (var a of [4]); a | [4, 4, object]
async function | { function a() {} } typeof a | [function, function, object]
async function | var a = 4; delete a | [true, 1, object]
async function | var d = 4; d | [4, 1, object]
async function | a = 4; a | [4, 4, object]
async function | arguments = 4; arguments | [4, 1, number]
async function | let a = 4; a | [4, 1, object]
async function | delete a | [false, 1, object]
async function | (() => { var a = 4; return a; })() | [4, 1, object]
async function | 'use strict'; var a = 4; a | [4, 1, object]
async arrow function | var a; a | [undefined, undefined]
async arrow function | var a = 4; a | [4, 4]
async arrow function | function a() {} typeof a | [function, function]
async arrow function | var b; b | [undefined, 1]
async arrow function | var arguments; typeof arguments | [undefined, 1]
async arrow function | var arguments = 4; arguments | [4, 1]
async arrow function | function arguments() {} typeof arguments | [function, 1]
async arrow function | { var a = 4; } a | [4, 4]
async arrow function | for (var a of [4]); a | [4, 4]
async arrow function | { function a() {} } typeof a | [function, function]
async arrow function | var a = 4; delete a | [true, 1]
async arrow function | var d = 4; d | [4, 1]
async arrow function | a = 4; a | [4, 4]
async arrow function | arguments = 4; arguments | [4, 1]
async arrow function | let a = 4; a | [4, 1]
async arrow function | delete a | [false, 1]
async arrow function | (() => { var a = 4; return a; })() | [4, 1]
async arrow function | 'use strict'; var a = 4; a | [4, 1]
async generator | var a; a | [undefined, undefined, object]
async generator | var a = 4; a | [4, 4, object]
async generator | function a() {} typeof a | [function, function, object]
async generator | var b; b | [undefined, 1, object]
async generator | var arguments; typeof arguments | [undefined, 1, undefined]
async generator | var arguments = 4; arguments | [4, 1, number]
async generator | function arguments() {} typeof arguments | [function, 1, function]
async generator | { var a = 4; } a | [4, 4, object]
async generator | for (var a of [4]); a | [4, 4, object]
async generator | { function a() {} } typeof a | [function, function, object]
async generator | var a = 4; delete a | [true, 1, object]
async generator | var d = 4; d | [4, 1, object]
async generator | a = 4; a | [4, 4, object]
async generator | arguments = 4; arguments | [4, 1, number]
async generator | let a = 4; a | [4, 1, object]
async generator | delete a | [false, 1, object]
async generator | (() => { var a = 4; return a; })() | [4, 1, object]
async generator | 'use strict'; var a = 4; a | [4, 1, object]
function without expressions among its parameters | var a; a | [1, 1, 1, undefined, object]
function without expressions among its parameters | var a = 4; a | [1, 4, 4, undefined, object]
function without expressions among its parameters | function a() {} typeof a | [1, function, function, undefined, object]
function without expressions among its parameters | var b; b | [1, undefined, 1, undefined, object]
function without expressions among its parameters | var arguments; typeof arguments | [1, object, 1, undefined, object]
function without expressions among its parameters | var arguments = 4; arguments | [1, 4, 1, undefined, number]
function without expressions among its parameters | function arguments() {} typeof arguments | [1, function, 1, undefined, function]
function without expressions among its parameters | { var a = 4; } a | [1, 4, 4, undefined, object]
function without expressions among its parameters | for (var a of [4]); a | [1, 4, 4, undefined, object]
function without expressions among its parameters | { function a() {} } typeof a | [1, function, function, undefined, object]
function without expressions among its parameters | var a = 4; delete a | [1, false, 4, undefined, object]
function without expressions among its parameters | var d = 4; d | [1, 4, 1, undefined, object]
function without expressions among its parameters | a = 4; a | [1, 4, 4, undefined, object]
function without expressions among its parameters | arguments = 4; arguments | [1, 4, 1, undefined, number]
function without expressions among its parameters | let a = 4; a | [1, 4, 1, undefined, object]
function without expressions among its parameters | delete a | [1, false, 1, undefined, object]
function without expressions among its parameters | (() => { var a = 4; return a; })() | [1, 4, 1, undefined, object]
function without expressions among its parameters | 'use strict'; var a = 4; a | [1, 4, 1, undefined, object]
*/
