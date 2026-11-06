// RUN(SUM): lower
// SUM-LABEL: function {{*}}name="sum"
// SUM-NOT: RequireDynamic
// SUM: EvaluateModule module=m
// SUM: Return

// RUN(SUMS): lower
// SUMS-LABEL: function {{*}}name="sums"
// SUMS-NOT: RequireDynamic
// SUMS: EvaluateModule module=m
// SUMS: Return

// RUN(TEMPLATE): lower
// TEMPLATE-LABEL: function {{*}}name="template"
// TEMPLATE-NOT: RequireDynamic
// TEMPLATE: EvaluateModule module=m
// TEMPLATE: Return

// RUN(RESOLVED): lower
// RESOLVED-LABEL: function {{*}}name="resolved"
// RESOLVED-NOT: ResolveDynamic
// RESOLVED: = ResolveModule module=m{{*}}specifier="./imports/common.cjs"
// RESOLVED: Return

// RUN(IMPORTED): lower
// IMPORTED-LABEL: function {{*}}name="imported"
// IMPORTED-NOT: ImportDynamic
// IMPORTED: = ImportModule module=m
// IMPORTED: Return

// RUN(DECLARED): lower
// DECLARED-LABEL: function {{*}}name="declared"
// DECLARED-NOT: EvaluateModule
// DECLARED: = RequireDynamic
// DECLARED: Return

function sum() {
  return require(__dirname + "/imports/common.cjs");
}

function sums() {
  return require(__dirname + "/imports" + "/common" + ".cjs");
}

function template() {
  return require(`${__dirname}/imports/common.cjs`);
}

function resolved() {
  return require.resolve(__dirname + "/imports/common.cjs");
}

function imported() {
  return import(__dirname + "/imports/common.cjs");
}

function declared(__dirname) {
  return require(__dirname + "/imports/common.cjs");
}

module.exports = { sum, sums, template, resolved, imported, declared };
