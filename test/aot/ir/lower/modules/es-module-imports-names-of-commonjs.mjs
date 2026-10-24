// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = GetModuleVariable
// CHECK: Return

// RUN(NOWHERE): link
// NOWHERE-NOT: CheckInitialized {{*}}name="one"
// NOWHERE-NOT: CheckInitialized {{*}}name="g"
// NOWHERE-NOT: syntheticExports=
// NOWHERE-NOT: layout {{*}}key="one"

// RUN(FILES): link
// FILES: function {{*}}kind=CommonJsModule
// FILES-NOT: PropSet
// FILES: function {{*}}role=Library

// RUN(RECORDS): link
// RECORDS: module {{*}}/imports/chain/k.cjs"{{*}}kind=CommonJs

// RUN(MODULES): link
// MODULES-NOT: module m
// MODULES: module [[k]] path="{{*}}/imports/chain/k.cjs"
// MODULES-NEXT: module {{*}}path="{{*}}/es-module-imports-names-of-commonjs"{{*}}requests=[{target=[[k]] completes=true}]
// MODULES-NEXT: module {{*}}flags=[IsLibrary]

// Both names are stored once, in order, by a module that nobody can see half done: a copy and a live read cannot be told apart, so the importer reads the variables of the CommonJS file, and there is no record between the two.
import { one, g } from "./imports/chain/k.cjs";
export const c = one;
export function f(x) {
  return g(x);
}
