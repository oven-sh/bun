// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 22

// FILE: main.js
// Each module defines a class that extends an object literal and that nothing uses, each in another syntactic form.
const modules = [
  ["const", () => import("./const.js")],
  ["let", () => import("./let.js")],
  ["var", () => import("./var.js")],
  ["named-class-expression", () => import("./named-class-expression.js")],
  ["expression-statement", () => import("./expression-statement.js")],
  ["typeof", () => import("./typeof.js")],
  ["comma", () => import("./comma.js")],
  ["array-element", () => import("./array-element.js")],
  ["property-value", () => import("./property-value.js")],
  ["static-field", () => import("./static-field.js")],
  ["static-block", () => import("./static-block.js")],
  ["conditional", () => import("./conditional.js")],
  ["block", () => import("./block.js")],
  ["exported-class", () => import("./exported-class.js")],
  ["exported-const", () => import("./exported-const.js")],
  ["exported-later", () => import("./exported-later.js")],
  ["default-export", () => import("./default-export.js")],
  ["named-default-export", () => import("./named-default-export.js")],
  ["default-export-in-parentheses", () => import("./default-export-in-parentheses.js")],
  ["function-that-is-called", () => import("./function-that-is-called.js")],
  ["function-that-is-never-called", () => import("./function-that-is-never-called.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}

// FILE: array-element.js
const unused = [class extends {} {}];

// FILE: block.js
{
  class Unused extends {} {}
}

// FILE: comma.js
(0, class extends {} {});

// FILE: conditional.js
const unused = globalThis.nothing ? 1 : class extends {} {};

// FILE: const.js
const Unused = class extends {} {};

// FILE: default-export-in-parentheses.js
export default (class extends {} {});

// FILE: default-export.js
export default class extends {} {}

// FILE: exported-class.js
export class Unused extends {} {}

// FILE: exported-const.js
export const Unused = class extends {} {};

// FILE: exported-later.js
class Unused extends {} {}
export { Unused };

// FILE: expression-statement.js
(class extends {} {});

// FILE: function-that-is-called.js
function define() {
  class Unused extends {} {}
}
define();

// FILE: function-that-is-never-called.js
function define() {
  class Unused extends {} {}
}

// FILE: let.js
let Unused = class extends {} {};

// FILE: named-class-expression.js
const Unused = class Named extends {} {};

// FILE: named-default-export.js
export default class Unused extends {} {}

// FILE: property-value.js
const unused = { value: class extends {} {} };

// FILE: static-block.js
class Unused {
  static {
    class Inner extends {} {}
  }
}

// FILE: static-field.js
class Unused {
  static value = class extends {} {};
}

// FILE: typeof.js
typeof class extends {} {};

// FILE: var.js
var Unused = class extends {} {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
