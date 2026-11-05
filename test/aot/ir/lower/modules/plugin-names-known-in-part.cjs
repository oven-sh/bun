// A program that names Bun.plugin. `bun build` leaves a name that is not written out in the call to the run time, where a plugin answers first.
// So does this build where it knows every file that the name may lead to: the call asks the loader, which finds each of them by its name where no plugin answers.
// A choice that is written out in the call is linked, as `bun build` links it. So is a folder whose package.json names its main file: the loader of an executable reads none.

// RUN(CHOSEN): lower
// CHOSEN-LABEL: function {{*}}name="chosen"
// CHOSEN-NOT: SwitchString
// CHOSEN-NOT: ImportModule
// CHOSEN: = ImportDynamic {{*}}[allNamesAreKnown]
// CHOSEN-NOT: ImportModule
// CHOSEN: Return

// RUN(PREFIXED): lower
// PREFIXED-LABEL: function {{*}}name="prefixed"
// PREFIXED-NOT: SwitchString
// PREFIXED-NOT: ImportModule
// PREFIXED: = ImportDynamic
// PREFIXED-NOT: ImportModule
// PREFIXED: Return

// RUN(REQUIRED): lower
// REQUIRED-LABEL: function {{*}}name="required"
// REQUIRED-NOT: SwitchString
// REQUIRED: = RequireDynamic
// REQUIRED-NOT: SwitchString
// REQUIRED: Return

// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN-NOT: ImportDynamic
// WRITTEN: SwitchString {{*}}strings=["./imports/pages/first.ts", "./imports/pages/second.ts"]
// WRITTEN: = ImportModule module=m
// WRITTEN: = ImportModule module=m
// WRITTEN-NOT: ImportDynamic
// WRITTEN: Unreachable

// RUN(PACKAGE): lower
// PACKAGE-LABEL: function {{*}}name="ofPackage"
// PACKAGE: SwitchString {{*}}strings=["./imports/folder-with-main"] -> case [[linked]](), otherwise [[other]]()
// PACKAGE: = ImportModule module=m
// PACKAGE: = ImportDynamic

// RUN(FIRST): link
// FIRST: path="{{*}}/pages/first.ts"{{*}}IsFoundByName

// RUN(SECOND): link
// SECOND: path="{{*}}/pages/second.ts"{{*}}IsFoundByName

Bun.plugin({ name: "p", setup() {} });

function chosen(flag) {
  const pick = flag ? "./imports/pages/first.ts" : "./imports/pages/second.ts";
  return import(pick);
}

function prefixed(name) {
  return import("./imports/pages/" + name + ".ts");
}

function required(name) {
  return require(`./imports/pages/${name}.ts`);
}

function written(flag) {
  return import(flag ? "./imports/pages/first.ts" : "./imports/pages/second.ts");
}

function ofPackage(flag) {
  const pick = flag ? "./imports/folder-with-main" : "./imports/pages/first.ts";
  return import(pick);
}

module.exports = { chosen, prefixed, required, written, ofPackage };
