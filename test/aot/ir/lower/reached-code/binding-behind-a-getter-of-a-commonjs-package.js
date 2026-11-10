// RUN: link
// CHECK: variable {{*}}name="names"

// The name stands for a binding of the package, and whoever requires the name reads the variable of that binding. The call that defines the getter is not
// made, so no code of the package names the variable: the package defines it all the same.

// FILE: main.cjs
const { names } = require("declared");
console.log(names({ first: 1 }));

// FILE: node_modules/declared/package.json
{ "name": "declared", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }

// FILE: node_modules/declared/index.d.ts
export function names(keys: object): number;

// FILE: node_modules/declared/index.js
Object.defineProperty(exports, "__esModule", { value: true });
function names(keys) { return Object.keys(keys).length; }
Object.defineProperty(exports, "names", { enumerable: true, get: function () { return names; } });
