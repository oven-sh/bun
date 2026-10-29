// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 74

// FILE: main.js
// Each module defines a class at its top level that nothing uses and that extends an import. In the cycles, the class is defined before the module that it imports from has run.
const modules = [
  ["named-declared", () => import("./named-declared.js")],
  ["namespace-declared", () => import("./namespace-declared.js")],
  ["reexported-declared", () => import("./reexported-declared.js")],
  ["named-constant", () => import("./named-constant.js")],
  ["namespace-constant", () => import("./namespace-constant.js")],
  ["reexported-constant", () => import("./reexported-constant.js")],
  ["named-variable", () => import("./named-variable.js")],
  ["namespace-variable", () => import("./namespace-variable.js")],
  ["reexported-variable", () => import("./reexported-variable.js")],
  ["named-reassigned", () => import("./named-reassigned.js")],
  ["namespace-reassigned", () => import("./namespace-reassigned.js")],
  ["reexported-reassigned", () => import("./reexported-reassigned.js")],
  ["named-conditional", () => import("./named-conditional.js")],
  ["namespace-conditional", () => import("./namespace-conditional.js")],
  ["reexported-conditional", () => import("./reexported-conditional.js")],
  ["named-ordinary", () => import("./named-ordinary.js")],
  ["namespace-ordinary", () => import("./namespace-ordinary.js")],
  ["reexported-ordinary", () => import("./reexported-ordinary.js")],
  ["named-without-prototype", () => import("./named-without-prototype.js")],
  ["namespace-without-prototype", () => import("./namespace-without-prototype.js")],
  ["reexported-without-prototype", () => import("./reexported-without-prototype.js")],
  ["named-asynchronous", () => import("./named-asynchronous.js")],
  ["namespace-asynchronous", () => import("./namespace-asynchronous.js")],
  ["reexported-asynchronous", () => import("./reexported-asynchronous.js")],
  ["named-arrow", () => import("./named-arrow.js")],
  ["namespace-arrow", () => import("./namespace-arrow.js")],
  ["reexported-arrow", () => import("./reexported-arrow.js")],
  ["named-object", () => import("./named-object.js")],
  ["namespace-object", () => import("./namespace-object.js")],
  ["reexported-object", () => import("./reexported-object.js")],
  ["named-nothing", () => import("./named-nothing.js")],
  ["namespace-nothing", () => import("./namespace-nothing.js")],
  ["reexported-nothing", () => import("./reexported-nothing.js")],
  ["named-none", () => import("./named-none.js")],
  ["namespace-none", () => import("./namespace-none.js")],
  ["reexported-none", () => import("./reexported-none.js")],
  ["named-renamed", () => import("./named-renamed.js")],
  ["namespace-renamed", () => import("./namespace-renamed.js")],
  ["reexported-renamed", () => import("./reexported-renamed.js")],
  ["default-class", () => import("./default-class.js")],
  ["default-object", () => import("./default-object.js")],
  ["namespace-itself", () => import("./namespace-itself.js")],
  ["missing-member", () => import("./missing-member.js")],
  ["replaced-by-a-call", () => import("./replaced-by-a-call.js")],
  ["commonjs-class", () => import("./commonjs-class.js")],
  ["commonjs-object", () => import("./commonjs-object.js")],
  ["commonjs-named-class", () => import("./commonjs-named-class.js")],
  ["commonjs-named-object", () => import("./commonjs-named-object.js")],
  ["event-emitter", () => import("./event-emitter.js")],
  ["event-emitter-once", () => import("./event-emitter-once.js")],
  ["readable", () => import("./readable.js")],
  ["tty-write-stream", () => import("./tty-write-stream.js")],
  ["tty-read-stream", () => import("./tty-read-stream.js")],
  ["file-system", () => import("./file-system.js")],
  ["path-separator", () => import("./path-separator.js")],
  ["cycle-var", () => import("./cycle-var.js")],
  ["cycle-var-through-a-namespace", () => import("./cycle-var-through-a-namespace.js")],
  ["cycle-function", () => import("./cycle-function.js")],
  ["cycle-entered-at-the-class", () => import("./cycle-entered-at-the-class.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}

// FILE: bases/bases.js
export class Declared {}
export const constant = class {};
export var variable = class {};
export let reassigned = class {};
reassigned = {};
export let replaceable = class {};
export function replace() {
  replaceable = 5;
}
if (globalThis.nothing) {
  var conditional = class {};
}
export { conditional };
export function ordinary() {}
export function withoutPrototype() {}
withoutPrototype.prototype = 5;
export async function asynchronous() {}
export const arrow = () => {};
export const object = {};
export const nothing = undefined;
export const none = null;
export { Declared as renamed };
export default class {}

// FILE: bases/class.cjs
module.exports = class {};

// FILE: bases/default-object.js
export default {};

// FILE: bases/names.cjs
exports.Named = class {};
exports.object = {};

// FILE: bases/object.cjs
module.exports = {};

// FILE: bases/reexports.js
export * from "./bases.js";

// FILE: commonjs-class.js
import Base from "./bases/class.cjs";
class Unused extends Base {}

// FILE: commonjs-named-class.js
import { Named } from "./bases/names.cjs";
class Unused extends Named {}

// FILE: commonjs-named-object.js
import { object } from "./bases/names.cjs";
class Unused extends object {}

// FILE: commonjs-object.js
import base from "./bases/object.cjs";
class Unused extends base {}

// FILE: cycle-entered-at-the-class.js
import "./cycles/entered-early.js";

// FILE: cycle-function.js
import "./cycles/function-late.js";

// FILE: cycle-var-through-a-namespace.js
import "./cycles/namespace-late.js";

// FILE: cycle-var.js
import "./cycles/var-late.js";

// FILE: cycles/entered-early.js
import { Base } from "./entered-late.js";
class Unused extends Base {}

// FILE: cycles/entered-late.js
import "./entered-early.js";
export var Base = class {};

// FILE: cycles/function-early.js
import { Base } from "./function-late.js";
class Unused extends Base {}

// FILE: cycles/function-late.js
import "./function-early.js";
export function Base() {}

// FILE: cycles/namespace-early.js
import * as late from "./namespace-late.js";
var Unused = class extends late.Base {};

// FILE: cycles/namespace-late.js
import "./namespace-early.js";
export var Base = class {};

// FILE: cycles/var-early.js
import { Base } from "./var-late.js";
class Unused extends Base {}

// FILE: cycles/var-late.js
import "./var-early.js";
export var Base = class {};

// FILE: default-class.js
import Base from "./bases/bases.js";
class Unused extends Base {}

// FILE: default-object.js
import base from "./bases/default-object.js";
class Unused extends base {}

// FILE: event-emitter-once.js
import { once } from "node:events";
class Unused extends once {}

// FILE: event-emitter.js
import { EventEmitter } from "node:events";
class Unused extends EventEmitter {}

// FILE: file-system.js
import fs from "node:fs";
class Unused extends fs {}

// FILE: missing-member.js
import * as bases from "./bases/bases.js";
class Unused extends bases.missing {}

// FILE: named-arrow.js
import { arrow } from "./bases/bases.js";
class Unused extends arrow {}

// FILE: named-asynchronous.js
import { asynchronous } from "./bases/bases.js";
class Unused extends asynchronous {}

// FILE: named-conditional.js
import { conditional } from "./bases/bases.js";
class Unused extends conditional {}

// FILE: named-constant.js
import { constant } from "./bases/bases.js";
class Unused extends constant {}

// FILE: named-declared.js
import { Declared } from "./bases/bases.js";
class Unused extends Declared {}

// FILE: named-none.js
import { none } from "./bases/bases.js";
class Unused extends none {}

// FILE: named-nothing.js
import { nothing } from "./bases/bases.js";
class Unused extends nothing {}

// FILE: named-object.js
import { object } from "./bases/bases.js";
class Unused extends object {}

// FILE: named-ordinary.js
import { ordinary } from "./bases/bases.js";
class Unused extends ordinary {}

// FILE: named-reassigned.js
import { reassigned } from "./bases/bases.js";
class Unused extends reassigned {}

// FILE: named-renamed.js
import { renamed } from "./bases/bases.js";
class Unused extends renamed {}

// FILE: named-variable.js
import { variable } from "./bases/bases.js";
class Unused extends variable {}

// FILE: named-without-prototype.js
import { withoutPrototype } from "./bases/bases.js";
class Unused extends withoutPrototype {}

// FILE: namespace-arrow.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.arrow {};

// FILE: namespace-asynchronous.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.asynchronous {};

// FILE: namespace-conditional.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.conditional {};

// FILE: namespace-constant.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.constant {};

// FILE: namespace-declared.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.Declared {};

// FILE: namespace-itself.js
import * as bases from "./bases/bases.js";
class Unused extends bases {}

// FILE: namespace-none.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.none {};

// FILE: namespace-nothing.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.nothing {};

// FILE: namespace-object.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.object {};

// FILE: namespace-ordinary.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.ordinary {};

// FILE: namespace-reassigned.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.reassigned {};

// FILE: namespace-renamed.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.renamed {};

// FILE: namespace-variable.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.variable {};

// FILE: namespace-without-prototype.js
import * as bases from "./bases/bases.js";
var Unused = class extends bases.withoutPrototype {};

// FILE: path-separator.js
import { sep } from "node:path";
class Unused extends sep {}

// FILE: readable.js
import { Readable } from "node:stream";
class Unused extends Readable {}

// FILE: reexported-arrow.js
import { arrow } from "./bases/reexports.js";
class Unused extends arrow {}

// FILE: reexported-asynchronous.js
import { asynchronous } from "./bases/reexports.js";
class Unused extends asynchronous {}

// FILE: reexported-conditional.js
import { conditional } from "./bases/reexports.js";
class Unused extends conditional {}

// FILE: reexported-constant.js
import { constant } from "./bases/reexports.js";
class Unused extends constant {}

// FILE: reexported-declared.js
import { Declared } from "./bases/reexports.js";
class Unused extends Declared {}

// FILE: reexported-none.js
import { none } from "./bases/reexports.js";
class Unused extends none {}

// FILE: reexported-nothing.js
import { nothing } from "./bases/reexports.js";
class Unused extends nothing {}

// FILE: reexported-object.js
import { object } from "./bases/reexports.js";
class Unused extends object {}

// FILE: reexported-ordinary.js
import { ordinary } from "./bases/reexports.js";
class Unused extends ordinary {}

// FILE: reexported-reassigned.js
import { reassigned } from "./bases/reexports.js";
class Unused extends reassigned {}

// FILE: reexported-renamed.js
import { renamed } from "./bases/reexports.js";
class Unused extends renamed {}

// FILE: reexported-variable.js
import { variable } from "./bases/reexports.js";
class Unused extends variable {}

// FILE: reexported-without-prototype.js
import { withoutPrototype } from "./bases/reexports.js";
class Unused extends withoutPrototype {}

// FILE: replaced-by-a-call.js
import { replaceable, replace } from "./bases/bases.js";
replace();
class Unused extends replaceable {}

// FILE: tty-read-stream.js
import { ReadStream } from "node:tty";
class Unused extends ReadStream {}

// FILE: tty-write-stream.js
import { WriteStream } from "node:tty";
class Unused extends WriteStream {}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
