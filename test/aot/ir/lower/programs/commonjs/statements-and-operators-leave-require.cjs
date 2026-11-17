// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 29

// FILE: main.cjs
// Whether a file is sloppy or strict when a statement or an operator never reaches its only `require`.
require("./conditional.js");
require("./and.js");
require("./or.js");
require("./nullish.js");
require("./else.js");
require("./while.js");
require("./for.js");
require("./switch.js");
require("./behind-return.js");
require("./behind-throw.js");
require("./nested-function.js");
require("./false-conditional.js");
require("./false-and.js");
require("./one-nullish.js");
require("./else-of-true.js");
require("./while-false.js");
require("./for-false.js");
require("./switch-on-a-number.js");
require("./switch-default.js");
require("./behind-plain-return.js");
require("./behind-plain-throw.js");
require("./behind-break.js");
require("./behind-continue.js");
require("./behind-labeled-break.js");
require("./behind-return-on-both-ways.js");
require("./function-never-called.js");
require("./test-names-require.js");
require("./test-names-require-in-a-function.js");

// FILE: and.js
typeof Bun === "undefined" && require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared53 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and", typeOfThis(), storeToUndeclaredName());

// FILE: behind-break.js
for (;;) {
  break;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared73 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-break", typeOfThis(), storeToUndeclaredName());

// FILE: behind-continue.js
for (let i = 0; i < 1; i++) {
  continue;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared74 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-continue", typeOfThis(), storeToUndeclaredName());

// FILE: behind-labeled-break.js
a: {
  break a;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared75 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-labeled-break", typeOfThis(), storeToUndeclaredName());

// FILE: behind-plain-return.js
function f() {
  return 1;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared71 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-return", typeOfThis(), storeToUndeclaredName());

// FILE: behind-plain-throw.js
try {
  throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared72 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-throw", typeOfThis(), storeToUndeclaredName());

// FILE: behind-return-on-both-ways.js
function f(a) {
  if (a) return 1;
  else return 2;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared76 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return-on-both-ways", typeOfThis(), storeToUndeclaredName());

// FILE: behind-return.js
function f() {
  if (typeof Bun !== "undefined") return 1;
  return require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared60 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return", typeOfThis(), storeToUndeclaredName());

// FILE: behind-throw.js
try {
  if (typeof Bun !== "undefined") throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared61 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-throw", typeOfThis(), storeToUndeclaredName());

// FILE: conditional.js
typeof Bun === "undefined" ? require("node:path") : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared52 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional", typeOfThis(), storeToUndeclaredName());

// FILE: else-of-true.js
if (true) {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared66 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-of-true", typeOfThis(), storeToUndeclaredName());

// FILE: else.js
if (typeof Bun !== "undefined") {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared56 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else", typeOfThis(), storeToUndeclaredName());

// FILE: false-and.js
false && require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared64 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-and", typeOfThis(), storeToUndeclaredName());

// FILE: false-conditional.js
false ? require("node:path") : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared63 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-conditional", typeOfThis(), storeToUndeclaredName());

// FILE: for-false.js
for (; false; ) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared68 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("for-false", typeOfThis(), storeToUndeclaredName());

// FILE: for.js
for (; typeof Bun === "undefined"; ) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared58 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("for", typeOfThis(), storeToUndeclaredName());

// FILE: function-never-called.js
function f() {
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared77 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("function-never-called", typeOfThis(), storeToUndeclaredName());

// FILE: nested-function.js
if (typeof Bun === "undefined") {
  (function () {
    module.exports = 1;
  })();
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared62 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nested-function", typeOfThis(), storeToUndeclaredName());

// FILE: nullish.js
globalThis.Bun ?? require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared55 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nullish", typeOfThis(), storeToUndeclaredName());

// FILE: one-nullish.js
1 ?? require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared65 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("one-nullish", typeOfThis(), storeToUndeclaredName());

// FILE: or.js
typeof Bun !== "undefined" || require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared54 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or", typeOfThis(), storeToUndeclaredName());

// FILE: switch-default.js
switch (1) {
  case 1:
    break;
  default:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared70 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-default", typeOfThis(), storeToUndeclaredName());

// FILE: switch-on-a-number.js
switch (1) {
  case 2:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared69 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-on-a-number", typeOfThis(), storeToUndeclaredName());

// FILE: switch.js
switch (typeof Bun) {
  case "undefined":
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared59 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch", typeOfThis(), storeToUndeclaredName());

// FILE: test-names-require-in-a-function.js
function f() {
  if (typeof require === "undefined") console.log(1);
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared79 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-names-require-in-a-function", typeOfThis(), storeToUndeclaredName());

// FILE: test-names-require.js
if (typeof require === "undefined") console.log(1);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared78 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-names-require", typeOfThis(), storeToUndeclaredName());

// FILE: while-false.js
while (false) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared67 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while-false", typeOfThis(), storeToUndeclaredName());

// FILE: while.js
while (typeof Bun === "undefined") require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared57 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while", typeOfThis(), storeToUndeclaredName());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
