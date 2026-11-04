// A program that names Bun.plugin. `bun build` leaves a name that is not written out in the call to the run time, where a plugin answers first.
// So does this build where it works the name out and finds no module under it: the call asks the loader. A name that is written out fails at the call.
// DIAGNOSTIC: TS100150 1

// RUN(IMPORTED): lower
// IMPORTED-LABEL: function {{*}}name="imported"
// IMPORTED-NOT: ThrowModuleFailure
// IMPORTED: = String string="virtual:lib"
// IMPORTED: = ImportDynamic
// IMPORTED-NOT: ThrowModuleFailure
// IMPORTED: Return

// RUN(REQUIRED): lower
// REQUIRED-LABEL: function {{*}}name="required"
// REQUIRED-NOT: ThrowModuleFailure
// REQUIRED: = String string="my-virtual"
// REQUIRED: = RequireDynamic
// REQUIRED-NOT: ThrowModuleFailure
// REQUIRED: Return

// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN-NOT: ImportDynamic
// WRITTEN: ThrowModuleFailure failure=q
// WRITTEN-NOT: ImportDynamic

Bun.plugin({ name: "p", setup() {} });

function imported() {
  return import(["virtual", "lib"].join(":"));
}

function required() {
  return require(["my", "virtual"].join("-"));
}

function written() {
  return import("./imports/none");
}

module.exports = { imported, required, written };
