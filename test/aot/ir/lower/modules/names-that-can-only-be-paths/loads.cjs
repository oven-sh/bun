// The language puts the start in front, and no module of the library begins so: nothing is asked of the text.
// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN-NOT: TypeTest
// WRITTEN-COUNT-8: = RequireDynamic {{*}}[namesNoLibraryModule]
// WRITTEN-NOT: TypeTest
// WRITTEN: Return

// RUN(IMPORTED): lower
// IMPORTED-LABEL: function {{*}}name="imported"
// IMPORTED-NOT: TypeTest
// IMPORTED: = ImportDynamic [[name]] referrer=m{{*}} [namesNoLibraryModule]
// IMPORTED: = ImportDynamic [[other]], [[options]] referrer=m{{*}} [namesNoLibraryModule]
// IMPORTED-NOT: TypeTest
// IMPORTED: Return

// The run calls what it finds under `resolve`: the text is held against what such a call answers.
// RUN(RESOLVED): lower
// RESOLVED-LABEL: function {{*}}name="resolved"
// RESOLVED: [[text]] = Call {{*}}calleeName="path.resolve"
// RESOLVED-NEXT: [[isText]] = TypeTest [[text]] testedType=string
// RESOLVED-NEXT: Branch [[isText]] -> taken [[asked]](), notTaken [[other]]()
// RESOLVED: [[asked]]():
// RESOLVED-NEXT: [[startsWith]] = Builtin builtin=StringPrototypeStartsWith [isNotReadFromHolder]
// RESOLVED-NEXT: [[slash]] = String string="/"
// RESOLVED-NEXT: [[answer]] = Call [[startsWith]], [[text]], [[slash]]
// RESOLVED-NEXT: [[isWhole]] = ToBoolean [[answer]]
// RESOLVED-NEXT: Branch [[isWhole]] -> taken [[whole]](), notTaken [[other]]()
// RESOLVED: [[whole]]():
// RESOLVED-NEXT: = RequireDynamic [[text]] referrer=m{{*}} [namesNoLibraryModule]
// RESOLVED: [[other]]():
// RESOLVED: String string="MODULE_NOT_FOUND"
// RESOLVED: Throw

// RUN(WINDOWS): lower
// OPTIONS(WINDOWS): platform=windows
// WINDOWS-LABEL: function {{*}}name="resolved"
// WINDOWS: [[colon]] = String string=":"
// WINDOWS-NEXT: [[second]] = Integer integer=1
// WINDOWS-NEXT: = Call [[startsWith]], [[text]], [[colon]], [[second]]
// WINDOWS: [[backslash]] = String string="\\"
// WINDOWS-NEXT: = Call {{*}}, [[text]], [[backslash]]
// WINDOWS: = RequireDynamic [[text]] referrer=m{{*}} [namesNoLibraryModule]

// RUN(MADE): lower
// MADE-LABEL: function {{*}}name="madeByCalls"
// MADE-COUNT-5: = TypeTest {{*}}testedType=string
// MADE-LABEL: function {{*}}name="importedFromCall"
// MADE: = TypeTest {{*}}testedType=string
// MADE: = ImportDynamic {{*}}[namesNoLibraryModule]
// MADE: String string="ERR_MODULE_NOT_FOUND"
// MADE: builtin=CompilerHelpersImportRejectedByLoader
// MADE-NOT: Throw
// MADE: Return

// RUN(TESTED): lower
// TESTED-LABEL: function {{*}}name="madeByCalls"
// TESTED-COUNT-5: = RequireDynamic {{*}}[namesNoLibraryModule]
// TESTED-NOT: RequireDynamic
// TESTED-LABEL: function {{*}}name="importedFromCall"

// RUN(NAMES): lower
// NAMES-LABEL: function {{*}}name="names"
// NAMES-COUNT-18: = RequireDynamic {{*}} referrer=m0 @
// NAMES-NOT: RequireDynamic
// NAMES: Return

// The program lies in a folder of its own, above which no packages are installed: a name that begins with "n", "bun" or "vi" finds none.
// FILE: names/loads.cjs
const path = require("node:path");

function written(name) {
  return [
    require("./imports/none-" + name),
    require("../none-" + name + ".cjs"),
    require("/none/" + name),
    require(`@kit/part-${name}/addon.node`),
    require(__dirname + "/imports/none-" + name),
    require(`${__dirname}/imports/none-${name}.cjs`),
    require("kit-" + name),
    require(`${name ? "./imports/none-" : "./imports/no-"}${name}`),
  ];
}

function imported(name) {
  return [import("./imports/none-" + name), import("./imports/none-" + name, { with: { type: "json" } })];
}

function resolved(name) {
  return require(path.resolve(name));
}

function madeByCalls(folder, name) {
  return [
    require(path.join(__dirname, "imports", "none-" + name)),
    require(path.join(__dirname, folder, name)),
    require(path.resolve(folder) + "/" + name),
    require(path.join(process.cwd(), name)),
    require(`${process.cwd()}/${name}`),
  ];
}

function importedFromCall(name) {
  return import(path.resolve(name));
}

function names(name, flag) {
  const own = { join: (...parts) => parts[parts.length - 1], resolve: part => part };
  return [
    require("" + name),
    require(name + "./none"),
    require(`${name}`),
    require("n" + name),
    require("node:" + name),
    require("bun" + name),
    require("@vercel/" + name),
    require("#" + name),
    require("@jest/" + name),
    require("vi" + name),
    require(name + ".cjs"),
    require("kit-" + encodeURIComponent("a b") + name),
    require(`${flag ? "./" : "node:"}${name}`),
    require((flag ? "./" : "node:") + name),
    require(path.join(name, "none")),
    require(path.join("./", name)),
    require(own.join(__dirname, name)),
    require(own.resolve(name)),
  ];
}

module.exports = [written, imported, resolved, madeByCalls, importedFromCall, names];
