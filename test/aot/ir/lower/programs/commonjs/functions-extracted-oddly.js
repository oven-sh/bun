// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6
// CHECK-LABEL: function {{*}}name="row"
// CHECK-LABEL: function {{*}}name="reassigned"

// FILE: main.js
function row(label, f) {
  let said;
  try {
    said = f();
  } catch (e) {
    said = "threw " + e.name;
  }
  console.log(label + ": " + String(said));
}
const tools = require("./files/tools.js");
const { plain, plain: renamed, missing, storedLate, replaced, absent = () => "the default" } = require("./files/tools.js");
let { plain: reassigned } = require("./files/tools.js");
const { literal } = require("./files/a_literal.js");
const { plain: throughAGetter } = require("./files/re_exports.js");
const { fromTheCycle, seenEarly } = require("./files/cycle_a.js");

row("an export", () => plain(1));
row("under another name", () => renamed(2));
row("the same closure", () => plain === renamed && plain === tools.plain);
row("a name that is not there", () => missing());
row("an export that is stored late", () => storedLate());
tools.storeLate();
row("the copy stays as it was", () => storedLate());
row("the export is there now", () => tools.storedLate());
row("an export that is replaced", () => replaced());
tools.replace();
row("the copy is not replaced", () => replaced());
row("the export is", () => tools.replaced());
row("a default in the pattern", () => absent());
row("a copy before it is stored to", () => reassigned(3));
reassigned = a => "reassigned " + a;
row("a copy that was stored to", () => reassigned(3));
row("module.exports = { .. }", () => literal(4));
row("re-exported through a getter", () => throughAGetter(5));
row("out of a cycle, afterwards", () => fromTheCycle());
row("what the other module of the cycle took out early", () => seenEarly());

// FILE: files/a_literal.js
function literal(a) {
  return "literal " + a;
}
module.exports = { literal };

// FILE: files/cycle_a.js
const b = require("./cycle_b.js");
exports.fromTheCycle = function () {
  return "from the cycle";
};
exports.seenEarly = function () {
  return b.callsWhatItTookOut();
};

// FILE: files/cycle_b.js
const { fromTheCycle } = require("./cycle_a.js");
exports.callsWhatItTookOut = function () {
  try {
    return fromTheCycle();
  } catch (e) {
    return "threw " + e.name + " in the other module";
  }
};

// FILE: files/re_exports.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plain = void 0;
var tools_1 = require("./tools.js");
Object.defineProperty(exports, "plain", { enumerable: true, get: function () { return tools_1.plain; } });

// FILE: files/tools.js
exports.plain = function (a) {
  return "plain " + a;
};
exports.storeLate = function () {
  exports.storedLate = function () {
    return "stored late";
  };
};
exports.replaced = function () {
  return "the first";
};
exports.replace = function () {
  exports.replaced = function () {
    return "the second";
  };
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
