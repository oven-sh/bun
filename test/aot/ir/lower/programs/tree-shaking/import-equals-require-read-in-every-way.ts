// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7
// CHECK-LABEL: function {{*}}name="call"
// CHECK-LABEL: function {{*}}name="Derived"

// FILE: main.ts
// What `import lib = require()` binds is read by name, by a computed name, in a pattern, given away, exported again and used after new and extends.
import byName = require("./by-name");
import byComputed = require("./by-computed");
import byPattern = require("./by-pattern");
import givenAway = require("./given-away");
import classes = require("./classes");
export import exportedAgain = require("./exported-again");
import * as self from "./main";

console.log(byName.target());
console.log((byComputed as any)["tar" + "get"]());
const { target } = byPattern;
console.log(target());
function call(lib: { target(): string }) { return lib.target(); }
console.log(call(givenAway));
class Derived extends classes.Base {}
console.log(new Derived().method(), new classes.Other().method());
console.log(self.exportedAgain.target());

// FILE: by-computed.ts
export function target() { return "by a computed name"; }

// FILE: by-name.ts
export function target() { return "by name"; }
export function unused() { return "unused"; }

// FILE: by-pattern.ts
export function target() { return "by a pattern"; }

// FILE: classes.ts
export class Base { method() { return "method of Base"; } }
export class Other { method() { return "method of Other"; } }

// FILE: exported-again.ts
export function target() { return "exported again"; }

// FILE: given-away.ts
export function target() { return "given away"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
