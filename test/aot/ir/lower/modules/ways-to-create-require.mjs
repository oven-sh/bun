// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherName"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="awaitedImport"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="calledArrow"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="dataFile"
// CHECK-NOT: RequireDynamic
// CHECK: = RequireModule module=m{{*}}specifier="./imports/data.json"
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="defaultImport"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="defaultOfNamespace"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="filename"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="getBuiltinModule"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="getBuiltinModuleHeld"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="getBuiltinModuleOfImportedProcess"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="getBuiltinModuleTakenApart"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="madeRequireAsksForNodeModule"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="memberOfAnObject"
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK: = Call
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="namespaceImport"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="oneOfTwoNames"
// CHECK: SwitchString
// CHECK: EvaluateModule module=m
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="packageName"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="url"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic

import { createRequire } from "node:module";
import { createRequire as renamed } from "module";
import * as namespace from "node:module";
import whole from "node:module";
import importedProcess from "node:process";

const byUrl = createRequire(import.meta.url);
const byFilename = createRequire(import.meta.filename);
const byRenamed = renamed(import.meta.url);
const byNamespace = namespace.createRequire(import.meta.url);
const byDefault = whole.createRequire(import.meta.url);
const byDefaultOfNamespace = namespace.default.createRequire(import.meta.url);
const { createRequire: takenApart } = process.getBuiltinModule("node:module");
const heldModule = globalThis.process.getBuiltinModule("module");
const byHeldModule = heldModule.createRequire(import.meta.url);
const byMadeRequire = byUrl("node:module").createRequire(import.meta.url);
const byAwaitedImport = (await import("node:module")).createRequire(import.meta.url);
const byCalledArrow = (() => createRequire(import.meta.url))();
const holder = { make: createRequire };
const byHolder = holder.make(import.meta.url);

export function url() {
  return byUrl("./imports/common.cjs");
}

export function filename() {
  return byFilename("./imports/common.cjs");
}

export function anotherName() {
  return byRenamed("./imports/common.cjs");
}

export function namespaceImport() {
  return byNamespace("./imports/common.cjs");
}

export function defaultImport() {
  return byDefault("./imports/common.cjs");
}

export function defaultOfNamespace() {
  return byDefaultOfNamespace("./imports/common.cjs");
}

export function getBuiltinModule() {
  return process.getBuiltinModule("node:module").createRequire(import.meta.url)("./imports/common.cjs");
}

export function getBuiltinModuleTakenApart() {
  return takenApart(import.meta.url)("./imports/common.cjs");
}

export function getBuiltinModuleHeld() {
  return byHeldModule("./imports/common.cjs");
}

export function getBuiltinModuleOfImportedProcess() {
  return importedProcess.getBuiltinModule("node:module").createRequire(import.meta.url)("./imports/common.cjs");
}

export function madeRequireAsksForNodeModule() {
  return byMadeRequire("./imports/common.cjs");
}

export function awaitedImport() {
  return byAwaitedImport("./imports/common.cjs");
}

export function calledArrow() {
  return byCalledArrow("./imports/common.cjs");
}

export function oneOfTwoNames(flag) {
  return byUrl(flag ? "./imports/common.cjs" : "./imports/replaces-exports.cjs");
}

export function dataFile() {
  return byUrl("./imports/data.json");
}

export function packageName() {
  return byUrl("values-package");
}

export function memberOfAnObject() {
  return byHolder("./imports/common.cjs");
}
