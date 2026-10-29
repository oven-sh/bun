// `export * from` as TypeScript emits it for CommonJS, two levels of it, in a program that only reads names of the re-exporting modules, as most do. A read gets what the getter of the binding
// would read, from the module that has the name: no getter, no accessor and no property is made for any of the names.
// COUNTER: StarsRecorded >= 3
// COUNTER: StarsCarriedOutLate = 0
"use strict";
const outer = require("./outer.cjs");
const middle = require("./middle.cjs");
const first = require("./first.cjs");
const second = require("./second.cjs");
const show = (from) => [from.one, from.two, from.shared, from.own, from.default, from.hidden, from.missing, from.__esModule, typeof from.toString].join(" | ");
console.log(show(outer));
console.log(show(middle));
first.one = "one, stored later";
second.two = "two, stored later";
first.late = "a name that first got behind the star";
middle.own = "own of middle, stored later";
console.log(show(outer), "|", outer.late, "|", middle.late);
let text = "";
for (let i = 0; i < 20; i++) text = outer.one + outer.two;
console.log(text);
const name = ["o", "n", "e"].join("");
console.log(outer[name], middle[name], Reflect.get(outer, name), outer?.["two"]);
const { one, two: renamed } = outer;
console.log(one, renamed);
