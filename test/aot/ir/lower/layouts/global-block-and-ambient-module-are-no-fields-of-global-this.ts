// RUN: link
// CHECK: layout {{*}}key="besideTheBlock"

// RUN(OTHERS): link
// OTHERS-NOT: key="\xfe
// OTHERS-NOT: key="\"

/// <reference path="./imports/script-with-a-global-block-and-an-ambient-module.d.ts" />

// A file without imports and exports is a script. What it declares is global, also a `declare global` block, under a name that the
// checker reserves, and a `declare module "name"`. Neither is a property of `globalThis`.
Object.assign(globalThis, { added: 1 });
