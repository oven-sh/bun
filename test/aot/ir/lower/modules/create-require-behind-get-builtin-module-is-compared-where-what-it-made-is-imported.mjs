// RUN: link
// OPTIONS: runs-tests
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[read]] = PropGet {{*}}key="createRequire"
// CHECK: [[real]] = Builtin builtin=NodeModuleCreateRequire
// CHECK-NEXT: [[same]] = StrictEq [[read]], [[real]]
// CHECK-NEXT: Branch [[same]]
// CHECK: = Call [[read]], {{*}}calleeName="createRequire"
// CHECK: String string="Cannot call createRequire:
// CHECK: Throw

// FILE: main.mjs
import { load } from "./maker.mjs";
export function ask() {
  return load("./part.cjs");
}

// FILE: maker.mjs
const { createRequire } = process.getBuiltinModule("node:module");
export const load = createRequire(import.meta.url);

// FILE: part.cjs
module.exports = 1;
