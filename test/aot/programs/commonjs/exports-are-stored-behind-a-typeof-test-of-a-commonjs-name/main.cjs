// A file stores what it exports only where `typeof` says that a name of CommonJS is there. Each reader names the member alone.
console.log("required/define-is-asked-first", typeof require("./required/define-is-asked-first.cjs").foo);
console.log("required/exports-is-an-object-or-else", typeof require("./required/exports-is-an-object-or-else.cjs").foo);
console.log("required/exports-is-an-object", typeof require("./required/exports-is-an-object.cjs").foo);
console.log("required/exports-is-asked-in-a-loop", typeof require("./required/exports-is-asked-in-a-loop.cjs").foo);
console.log("required/exports-is-not-undefined", typeof require("./required/exports-is-not-undefined.cjs").foo);
console.log("required/exports-is-switched-on", typeof require("./required/exports-is-switched-on.cjs").foo);
console.log("required/exports-sorts-below-u", typeof require("./required/exports-sorts-below-u.cjs").foo);
console.log(
  "required/module-is-an-object-with-exports",
  typeof require("./required/module-is-an-object-with-exports.cjs").foo,
);
console.log("required/module-is-not-undefined", typeof require("./required/module-is-not-undefined.cjs").foo);
console.log("required/not-exports-is-undefined", typeof require("./required/not-exports-is-undefined.cjs").foo);
console.log(
  "required/object-is-loosely-what-exports-is",
  typeof require("./required/object-is-loosely-what-exports-is.cjs").foo,
);
console.log("required/require-is-a-function", typeof require("./required/require-is-a-function.cjs").foo);
console.log(
  "required/the-answer-for-exports-is-kept",
  typeof require("./required/the-answer-for-exports-is-kept.cjs").foo,
);
console.log("required/this-is-an-object", typeof require("./required/this-is-an-object.cjs").foo);
console.log(
  "required/universal-head-that-asks-define-first",
  typeof require("./required/universal-head-that-asks-define-first.cjs").foo,
);
console.log(
  "required/universal-head-that-hands-on-exports",
  typeof require("./required/universal-head-that-hands-on-exports.cjs").foo,
);
console.log(
  "required/universal-head-that-stores-what-the-factory-returns",
  typeof require("./required/universal-head-that-stores-what-the-factory-returns.cjs").foo,
);
console.log(
  "package-without-type/define-is-asked-first",
  require("./package-without-type/define-is-asked-first.js").foo(),
);
console.log(
  "package-without-type/exports-is-an-object-or-else",
  require("./package-without-type/exports-is-an-object-or-else.js").foo(),
);
console.log(
  "package-without-type/exports-is-an-object",
  require("./package-without-type/exports-is-an-object.js").foo(),
);
console.log(
  "package-without-type/exports-is-asked-in-a-loop",
  require("./package-without-type/exports-is-asked-in-a-loop.js").foo(),
);
console.log(
  "package-without-type/exports-is-not-undefined",
  require("./package-without-type/exports-is-not-undefined.js").foo(),
);
console.log(
  "package-without-type/exports-is-switched-on",
  require("./package-without-type/exports-is-switched-on.js").foo(),
);
console.log(
  "package-without-type/exports-sorts-below-u",
  require("./package-without-type/exports-sorts-below-u.js").foo(),
);
console.log(
  "package-without-type/module-is-an-object-with-exports",
  require("./package-without-type/module-is-an-object-with-exports.js").foo(),
);
console.log(
  "package-without-type/module-is-not-undefined",
  require("./package-without-type/module-is-not-undefined.js").foo(),
);
console.log(
  "package-without-type/not-exports-is-undefined",
  require("./package-without-type/not-exports-is-undefined.js").foo(),
);
console.log(
  "package-without-type/object-is-loosely-what-exports-is",
  require("./package-without-type/object-is-loosely-what-exports-is.js").foo(),
);
console.log(
  "package-without-type/require-is-a-function",
  require("./package-without-type/require-is-a-function.js").foo(),
);
console.log(
  "package-without-type/the-answer-for-exports-is-kept",
  require("./package-without-type/the-answer-for-exports-is-kept.js").foo(),
);
console.log("package-without-type/this-is-an-object", require("./package-without-type/this-is-an-object.js").foo());
console.log(
  "package-without-type/universal-head-that-asks-define-first",
  require("./package-without-type/universal-head-that-asks-define-first.js").foo(),
);
console.log(
  "package-without-type/universal-head-that-hands-on-exports",
  require("./package-without-type/universal-head-that-hands-on-exports.js").foo(),
);
console.log(
  "package-without-type/universal-head-that-stores-what-the-factory-returns",
  require("./package-without-type/universal-head-that-stores-what-the-factory-returns.js").foo(),
);
console.log(
  "package-of-type-commonjs/define-is-asked-first",
  require("./package-of-type-commonjs/define-is-asked-first.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-is-an-object-or-else",
  require("./package-of-type-commonjs/exports-is-an-object-or-else.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-is-an-object",
  require("./package-of-type-commonjs/exports-is-an-object.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-is-asked-in-a-loop",
  require("./package-of-type-commonjs/exports-is-asked-in-a-loop.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-is-not-undefined",
  require("./package-of-type-commonjs/exports-is-not-undefined.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-is-switched-on",
  require("./package-of-type-commonjs/exports-is-switched-on.js").foo(),
);
console.log(
  "package-of-type-commonjs/exports-sorts-below-u",
  require("./package-of-type-commonjs/exports-sorts-below-u.js").foo(),
);
console.log(
  "package-of-type-commonjs/module-is-an-object-with-exports",
  require("./package-of-type-commonjs/module-is-an-object-with-exports.js").foo(),
);
console.log(
  "package-of-type-commonjs/module-is-not-undefined",
  require("./package-of-type-commonjs/module-is-not-undefined.js").foo(),
);
console.log(
  "package-of-type-commonjs/not-exports-is-undefined",
  require("./package-of-type-commonjs/not-exports-is-undefined.js").foo(),
);
console.log(
  "package-of-type-commonjs/object-is-loosely-what-exports-is",
  require("./package-of-type-commonjs/object-is-loosely-what-exports-is.js").foo(),
);
console.log(
  "package-of-type-commonjs/require-is-a-function",
  require("./package-of-type-commonjs/require-is-a-function.js").foo(),
);
console.log(
  "package-of-type-commonjs/the-answer-for-exports-is-kept",
  require("./package-of-type-commonjs/the-answer-for-exports-is-kept.js").foo(),
);
console.log(
  "package-of-type-commonjs/this-is-an-object",
  require("./package-of-type-commonjs/this-is-an-object.js").foo(),
);
console.log(
  "package-of-type-commonjs/universal-head-that-asks-define-first",
  require("./package-of-type-commonjs/universal-head-that-asks-define-first.js").foo(),
);
console.log(
  "package-of-type-commonjs/universal-head-that-hands-on-exports",
  require("./package-of-type-commonjs/universal-head-that-hands-on-exports.js").foo(),
);
console.log(
  "package-of-type-commonjs/universal-head-that-stores-what-the-factory-returns",
  require("./package-of-type-commonjs/universal-head-that-stores-what-the-factory-returns.js").foo(),
);
require("./imported/read.mjs");
