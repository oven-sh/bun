// A CommonJS file requires the ES module that imports it. The loader loads that cycle and what imports it, and no other graph of the program.
// RUN: link
// CHECK: module [[lib]] path="{{*}}/require-cycle/lib.cjs"{{*}}flags=[KeepsError, IsLoadedByLoader, MayBeImportedWhileItRuns]
// CHECK: module [[main]] path="{{*}}/require-cycle/main.mjs"{{*}}flags=[KeepsError, IsLoadedByLoader, IsRequiredDuringLoad]
// CHECK: module [[first]] path="{{*}}/ticks/first.cjs"{{*}}flags=[KeepsError]
// CHECK: module [[between]] path="{{*}}/ticks/between.mjs"{{*}}flags=[KeepsError]
// CHECK: module [[both]] path="{{*}}/require-cycle/reaches-both.mjs"{{*}}flags=[KeepsError, IsLoadedByLoader]
// CHECK: module [[ticks]] path="{{*}}/ticks/main.mjs"{{*}}flags=[KeepsError]
// CHECK: module [[entry]] path="{{*}}/loader-mark-follows-the-require-cycle.mjs"{{*}}flags=[KeepsError]

import("./imports/require-cycle/main.mjs");
import("./imports/require-cycle/reaches-both.mjs");
import("./imports/ticks/main.mjs");
