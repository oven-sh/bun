// A program that names Bun.plugin. `bun build` leaves a name that is not written out in the call to the run time, where a plugin answers first.
// So does this build where it works the name out and finds no module under it: the call asks the loader. So does an import() of a name that is written out and that the build
// does not find: where `bun build` finds nothing it links nothing. There the build warns.
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
// WRITTEN-NOT: ThrowModuleFailure
// WRITTEN: = String string="./imports/none"
// WRITTEN: = ImportDynamic
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
