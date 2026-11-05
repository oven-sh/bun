// What a message does not quote whole: a function or an arrow with statements in its body, a class, a method, getter or setter in a literal, and a list or an object literal written on several lines.
// A failed call with one of them among its arguments is spelled without arguments, a call on one of them by the name alone, and a failed read names the value.
// docs/compiler/compatibility.mdx, "Error messages". Plain Bun prints another output. Whoever teaches the compiler to print statements turns these lines.
function tell(label, run) {
  try {
    run();
    console.log(label + ": no error");
  } catch (error) {
    console.log(label + ": " + error.name + ": " + JSON.stringify(error.message));
  }
}
const hide = value => [value][JSON.parse("0")];
const list = hide({});
let total = 0;
tell("an arrow with statements among the arguments", () => {
  list.forEech(item => {
    total += item;
  });
});
tell("a function with statements among the arguments", () => list.forEech(function (item) { total += item; }));
tell("an arrow with an expression among the arguments", () => list.forEech(item => total + item));
tell("a function expression is called on", () => (function named() {}).nope());
tell("an arrow with a statement is called on", () => ((x) => { return x; }).nope());
tell("a class is called on", () => (class Named { m() {} }).nope());
tell("a literal with a method is called on", () => ({ m() {} }).nope());
tell("a literal with a getter is called on", () => ({ get g() { return 1; } }).nope());
tell("a function expression is read from", () => (function () {}).a.b);
tell("a list on several lines among the arguments", () =>
  list.nope([
    1,
    2,
  ]),
);
tell("an object on several lines among the arguments", () =>
  list.nope({
    a: 1,
    b: 2,
  }),
);
tell("the same on one line", () => list.nope([1, 2], { a: 1, b: 2 }));
/* Output:
an arrow with statements among the arguments: TypeError: "list.forEech is not a function. (In 'list.forEech()', 'list.forEech' is undefined)"
a function with statements among the arguments: TypeError: "list.forEech is not a function. (In 'list.forEech()', 'list.forEech' is undefined)"
an arrow with an expression among the arguments: TypeError: "list.forEech is not a function. (In 'list.forEech((item) => total + item)', 'list.forEech' is undefined)"
a function expression is called on: TypeError: "nope is not a function. (In 'nope()', 'nope' is undefined)"
an arrow with a statement is called on: TypeError: "nope is not a function. (In 'nope()', 'nope' is undefined)"
a class is called on: TypeError: "nope is not a function. (In 'nope()', 'nope' is undefined)"
a literal with a method is called on: TypeError: "nope is not a function. (In 'nope()', 'nope' is undefined)"
a literal with a getter is called on: TypeError: "nope is not a function. (In 'nope()', 'nope' is undefined)"
a function expression is read from: TypeError: "undefined is not an object (evaluating 'undefined.b')"
a list on several lines among the arguments: TypeError: "list.nope is not a function. (In 'list.nope()', 'list.nope' is undefined)"
an object on several lines among the arguments: TypeError: "list.nope is not a function. (In 'list.nope()', 'list.nope' is undefined)"
the same on one line: TypeError: "list.nope is not a function. (In 'list.nope([1, 2], { a: 1, b: 2 })', 'list.nope' is undefined)"
*/
