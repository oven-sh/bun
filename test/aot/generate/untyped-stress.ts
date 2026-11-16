// The programs of untyped-stress that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "members-read-from-variables-stored-elsewhere/impl.js": text(
      `let sum = 0;`,
      [
        25,
        n => `(function () {
    var alias;
    function reader${2 * n}(o) { var found = 0; for (var k = 0; k < 3; ++k) { if (alias.call(o, "a")) ++found; } return found; }
    function pick${2 * n}() { return Object.prototype.hasOwnProperty; }
    function writer${2 * n}() { alias = pick${2 * n}(); }
    writer${2 * n}();
    sum += reader${2 * n}({ a: 1 });
})();
(function () {
    var price;
    function reader${2 * n + 1}() { var length = 0; for (var k = 0; k < 3; ++k) length += price.toFixed(2).length; return length; }
    function writer${2 * n + 1}(x) { price = x / 4; }
    writer${2 * n + 1}(5);
    sum += reader${2 * n + 1}();
})();`,
      ],
      `if (sum !== 375)
    throw new Error("the sum is " + sum);
console.log("passed");
`,
    ),
    "members-read-from-variables-stored-elsewhere/main.ts": text(
      `// Properties are read from variables that other functions assign.
import "./impl.js";
`,
    ),
    "object-literal-with-many-properties/impl.js": text(
      `function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function make(code) { return { code }; }
var many = {`,
      [2300, n => `    p${n}: make(${n}),`],
      `};`,
      [
        2,
        n => `function reads${2107 * n}() { return many.p${2107 * n}; }
for (let i = 0; i < 3; ++i) check(reads${2107 * n}().code, ${2107 * n}, "p${2107 * n} in a function");
check(many.p${2107 * n}.code, ${2107 * n}, "p${2107 * n} at the top level");
function reads${2047 * n + 61}() { return many.p${2047 * n + 61}; }
for (let i = 0; i < 3; ++i) check(reads${2047 * n + 61}().code, ${2047 * n + 61}, "p${2047 * n + 61} in a function");
check(many.p${2047 * n + 61}.code, ${2047 * n + 61}, "p${2047 * n + 61} at the top level");
function reads${2047 * n + 62}() { return many.p${2047 * n + 62}; }
for (let i = 0; i < 3; ++i) check(reads${2047 * n + 62}().code, ${2047 * n + 62}, "p${2047 * n + 62} in a function");
check(many.p${2047 * n + 62}.code, ${2047 * n + 62}, "p${2047 * n + 62} at the top level");
function reads${2047 * n + 63}() { return many.p${2047 * n + 63}; }
for (let i = 0; i < 3; ++i) check(reads${2047 * n + 63}().code, ${2047 * n + 63}, "p${2047 * n + 63} in a function");
check(many.p${2047 * n + 63}.code, ${2047 * n + 63}, "p${2047 * n + 63} at the top level");
function reads${64 * n + 2047}() { return many.p${64 * n + 2047}; }
for (let i = 0; i < 3; ++i) check(reads${64 * n + 2047}().code, ${64 * n + 2047}, "p${64 * n + 2047} in a function");
check(many.p${64 * n + 2047}.code, ${64 * n + 2047}, "p${64 * n + 2047} at the top level");
function reads${152 * n + 2048}() { return many.p${152 * n + 2048}; }
for (let i = 0; i < 3; ++i) check(reads${152 * n + 2048}().code, ${152 * n + 2048}, "p${152 * n + 2048} in a function");
check(many.p${152 * n + 2048}.code, ${152 * n + 2048}, "p${152 * n + 2048} at the top level");`,
      ],
      `function reads2299() { return many.p2299; }
for (let i = 0; i < 3; ++i) check(reads2299().code, 2299, "p2299 in a function");
check(many.p2299.code, 2299, "p2299 at the top level");
function writes() { many.p2109 = make(-1); many.p2299 = make(-2); return many.p2109.code + many.p2299.code; }
check(writes(), -3, "writes");
check(many.p2300, undefined, "a property that it does not have");
check(Object.keys(many).length, 2300, "the number of properties");
console.log("passed");
`,
    ),
    "object-literal-with-many-properties/main.ts": text(
      `// Object literals with more than 62 properties, in a function and at the top level.
import "./impl.js";
`,
    ),
  });
