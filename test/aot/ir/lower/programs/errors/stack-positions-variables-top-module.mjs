// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 12
// CHECK-LABEL: function {{*}}name="show"

// FILE: main.mjs
// Imports modules in which the value of a variable at the top is converted by code that throws, and prints the frames of each error.
async function show(load) {
  try {
    await load();
    console.log("no error");
  } catch (error) {
    console.log(
      String(error.stack)
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4])
        .join(" < "),
    );
  }
}
await show(() => import("./constant.mjs"));
await show(() => import("./variable.mjs"));
await show(() => import("./exported-constant.mjs"));
await show(() => import("./method-in-the-literal.mjs"));
await show(() => import("./handed-to-string.mjs"));
await show(() => import("./added.mjs"));
await show(() => import("./var-variable.mjs"));
await show(() => import("./read-by-a-function.mjs"));
await show(() => import("./behind-another-constant.mjs"));
await show(() => import("./behind-a-literal.mjs"));

// FILE: added.mjs
import { fail } from "./fail.mjs";
const atTop = 1 + { valueOf: () => fail() };

// FILE: behind-a-literal.mjs
import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `a${1}${holder}`;

// FILE: behind-another-constant.mjs
import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `${holder}`.length;

// FILE: constant.mjs
import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: exported-constant.mjs
import { fail } from "./fail.mjs";
export const atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: fail.mjs
export function fail() {
  throw new Error("fail");
}

// FILE: handed-to-string.mjs
import { fail } from "./fail.mjs";
const atTop = String({ toString: () => String(fail()) });

// FILE: method-in-the-literal.mjs
import { fail } from "./fail.mjs";
const atTop = `${{
  toString() {
    return String(fail());
  },
}}`.length;

// FILE: read-by-a-function.mjs
import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;
export function reads() {
  return atTop;
}

// FILE: var-variable.mjs
import { fail } from "./fail.mjs";
var atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: variable.mjs
import { fail } from "./fail.mjs";
let atTop = `${{ toString: () => String(fail()) }}`.length;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
