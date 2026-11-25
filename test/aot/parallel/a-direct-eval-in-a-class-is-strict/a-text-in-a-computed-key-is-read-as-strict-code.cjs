// What strict code may not say, a text in a computed key of a class may not say: `with`, a number with a leading zero, a store to a name that nobody declared.
// And `this` of a plain function that the text calls is undefined. `bun run` reads such a text as the code around the class: "level", "8", "number", "object".
// The output is stored: it is what the language says and, but for the wording, what Node.js prints.
const attempt = make => {
  try {
    return make();
  } catch (error) {
    return error.name;
  }
};
const keyOf = Class => Object.getOwnPropertyNames(Class.prototype).filter(name => name !== "constructor")[0];
console.log(
  attempt(() =>
    keyOf(
      class {
        [eval("with ({ name: 'level' }) name")]() {}
      },
    ),
  ),
);
console.log(
  attempt(() =>
    keyOf(
      class {
        [eval("010")]() {}
      },
    ),
  ),
);
console.log(
  attempt(
    () => (
      class {
        [eval("madeUpAndUndeclared = 1; 'level'")]() {}
      },
      typeof madeUpAndUndeclared
    ),
  ),
);
console.log(
  attempt(() =>
    keyOf(
      class {
        [eval("(function () { return typeof this; })()")]() {}
      },
    ),
  ),
);
/* Output:
SyntaxError
SyntaxError
ReferenceError
undefined
*/
