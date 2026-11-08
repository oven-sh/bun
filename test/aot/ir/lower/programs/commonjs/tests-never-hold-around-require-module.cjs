// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 35

// FILE: main.cjs
// Whether a file is sloppy or strict when its only `require` or `module.exports` is in a branch that is never taken.
require("./typeof-bun.require-call.js");
require("./typeof-bun.module-exports-store.js");
require("./global-this-bun.require-call.js");
require("./versions-bun.require-call.js");
require("./versions-bun.module-exports-store.js");
require("./is-bun.require-call.js");
require("./release-name.require-call.js");
require("./typeof-json.require-call.js");
require("./typeof-process.require-call.js");
require("./object-keys.require-call.js");
require("./bun-in-global-this.require-call.js");
require("./platform.require-call.js");
require("./platform.module-exports-store.js");
require("./arch.require-call.js");
require("./node-env.require-call.js");
require("./let-stored-once.require-call.js");
require("./var-stored-once.require-call.js");
require("./var-stored-once.module-exports-store.js");
require("./const-from-typeof-bun.require-call.js");
require("./const-object.require-call.js");
require("./optional-chain-on-null.require-call.js");
require("./number-equals-text.require-call.js");
require("./false.require-call.js");
require("./false.module-exports-store.js");
require("./const-zero.require-call.js");
require("./bun-and-false.require-call.js");
require("./bun-and-false.module-exports-store.js");
require("./false-and-bun.require-call.js");
require("./not-bun-or-true.require-call.js");
require("./typeof-function.require-call.js");
require("./typeof-regexp.require-call.js");
require("./typeof-require.require-call.js");
require("./unknown-global.require-call.js");
require("./unknown-global.module-exports-store.js");

// FILE: arch.require-call.js
if (process.arch === "pdp11") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared14 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("arch require-call", typeOfThis(), storeToUndeclaredName());

// FILE: bun-and-false.module-exports-store.js
if (typeof Bun !== "undefined" && false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared27 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-and-false module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: bun-and-false.require-call.js
if (typeof Bun !== "undefined" && false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared26 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-and-false require-call", typeOfThis(), storeToUndeclaredName());

// FILE: bun-in-global-this.require-call.js
if (!("Bun" in globalThis)) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared11 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-in-global-this require-call", typeOfThis(), storeToUndeclaredName());

// FILE: const-from-typeof-bun.require-call.js
const isBun = typeof Bun !== "undefined";
if (!isBun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared19 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-from-typeof-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: const-object.require-call.js
const always = {};
if (!always) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared20 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-object require-call", typeOfThis(), storeToUndeclaredName());

// FILE: const-zero.require-call.js
const never = 0;
if (never) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared25 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-zero require-call", typeOfThis(), storeToUndeclaredName());

// FILE: false-and-bun.require-call.js
if (false && typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared28 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-and-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: false.module-exports-store.js
if (false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared24 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: false.require-call.js
if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared23 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false require-call", typeOfThis(), storeToUndeclaredName());

// FILE: global-this-bun.require-call.js
if (globalThis.Bun === void 0) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared3 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("global-this-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: is-bun.require-call.js
if (!process.isBun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared6 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("is-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: let-stored-once.require-call.js
let never = 0;
if (never) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared16 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("let-stored-once require-call", typeOfThis(), storeToUndeclaredName());

// FILE: node-env.require-call.js
if (process.env.NODE_ENV === "never") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared15 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("node-env require-call", typeOfThis(), storeToUndeclaredName());

// FILE: not-bun-or-true.require-call.js
if (!(typeof Bun === "undefined" || true)) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared29 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-bun-or-true require-call", typeOfThis(), storeToUndeclaredName());

// FILE: number-equals-text.require-call.js
if (1 == "2") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared22 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("number-equals-text require-call", typeOfThis(), storeToUndeclaredName());

// FILE: object-keys.require-call.js
if (typeof Object.keys !== "function") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared10 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object-keys require-call", typeOfThis(), storeToUndeclaredName());

// FILE: optional-chain-on-null.require-call.js
if (null?.x) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared21 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("optional-chain-on-null require-call", typeOfThis(), storeToUndeclaredName());

// FILE: platform.module-exports-store.js
if (process.platform === "os/2") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared13 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("platform module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: platform.require-call.js
if (process.platform === "os/2") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared12 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("platform require-call", typeOfThis(), storeToUndeclaredName());

// FILE: release-name.require-call.js
if (process.release.name !== "node") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared7 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("release-name require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-bun.module-exports-store.js
if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared2 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-bun.require-call.js
if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared1 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-function.require-call.js
if (typeof function () {} === "string") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared30 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-function require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-json.require-call.js
if (typeof JSON === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared8 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-json require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-process.require-call.js
if (typeof process === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared9 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-process require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-regexp.require-call.js
if (typeof /x/ === "string") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared31 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-regexp require-call", typeOfThis(), storeToUndeclaredName());

// FILE: typeof-require.require-call.js
if (typeof require === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared32 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-require require-call", typeOfThis(), storeToUndeclaredName());

// FILE: unknown-global.module-exports-store.js
if (typeof neverDefinedAnywhere !== "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared34 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("unknown-global module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: unknown-global.require-call.js
if (typeof neverDefinedAnywhere !== "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared33 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("unknown-global require-call", typeOfThis(), storeToUndeclaredName());

// FILE: var-stored-once.module-exports-store.js
var never = 0;
if (never) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared18 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-stored-once module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: var-stored-once.require-call.js
var never = 0;
if (never) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared17 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-stored-once require-call", typeOfThis(), storeToUndeclaredName());

// FILE: versions-bun.module-exports-store.js
if (!process.versions.bun) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared5 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("versions-bun module-exports-store", typeOfThis(), storeToUndeclaredName());

// FILE: versions-bun.require-call.js
if (!process.versions.bun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared4 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("versions-bun require-call", typeOfThis(), storeToUndeclaredName());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
