// The text of a constant that the build writes into the text of a function stands behind a directive that no semicolon ends.
const enum Word { Strict = "use strict" }
const asked: Function[] = [
  function (this: unknown) {
    "use client"
    Word.Strict
    return this === undefined
  },
  function (this: unknown) {
    "use client"
    type Gone = number
    Word.Strict
    return this === undefined
  },
  function (this: unknown) {
    "use client";
    Word.Strict
    return this === undefined
  },
  function (this: unknown) {
    Word.Strict
    return this === undefined
  },
  function (this: unknown) {
    "use strict"
    Word.Strict
    return this === undefined
  },
];
console.log(asked.map(one => String(one())).join(" "));
console.log(asked.map(one => String(new Function("return (" + String(one) + "\n)")()())).join(" "));
