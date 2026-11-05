// The call tests that the parameter holds the require of this file. Any other function in its place is called.
// Whoever is handed a require finds the main module there, so the file keeps its module object and its calls of require are recorded.
// RUN(CALLED): lower
// CALLED-LABEL: function {{*}}name="called"
// CALLED: [[own]] = ModuleBuiltin builtin=ModuleRequire
// CALLED: [[same]] = StrictEq v0, [[own]]
// CALLED: Branch [[same]] -> taken [[known]](), notTaken [[other]](
// CALLED: [[known]]():
// CALLED-NEXT: RecordRequire module=m
// CALLED-NEXT: EvaluateModule module=m
// CALLED: [[other]]([[callee]]):
// CALLED-NEXT: = Call [[callee]]

// RUN(INNER): lower
// INNER-LABEL: function {{*}}name="inner"
// INNER: = ModuleBuiltin builtin=ModuleRequire
// INNER: EvaluateModule module=m

// RUN(THROUGHCALL): lower
// THROUGHCALL-LABEL: function {{*}}name="throughCall"
// THROUGHCALL: = Builtin builtin=FunctionPrototypeCall
// THROUGHCALL: = ModuleBuiltin builtin=ModuleRequire
// THROUGHCALL: EvaluateModule module=m

// RUN(USED): lower
// USED-LABEL: function {{*}}name="used"
// USED: = ModuleBuiltin builtin=ModuleRequire
// USED: EvaluateModule module=m

// RUN(ELSEWHERE): lower
// ELSEWHERE-LABEL: function {{*}}name="calledElsewhere"
// ELSEWHERE-NOT: EvaluateModule
// ELSEWHERE: [[result]] = Call v0
// ELSEWHERE-NEXT: Return [[result]]

// The wrapper that TypeScript writes for "module": "umd".
// RUN(UMD): link
// UMD: module [[join]] path="{{*}}/node_modules/wrapped/lib/parts/join.js"
// UMD: module [[wrapped]] path="{{*}}/node_modules/wrapped/lib/main.js"

const calledWhereWritten = (function called(load) {
  return load("./imports/common.cjs");
})(require);

const arrow = (load => load("./imports/common.cjs"))(require);

const passedOn = (function outer(first) {
  return (function inner(second) {
    return second("./imports/common.cjs");
  })(first);
})(require);

const throughCall = (function throughCall(load) {
  return load.call(null, "./imports/common.cjs");
})(require);

const factory = (function (use) {
  return [use(require), use(() => 1)];
})(function used(load) {
  return load("./imports/common.cjs");
});

function calledElsewhere(load) {
  return load("./imports/common.cjs");
}

module.exports = { calledWhereWritten, arrow, passedOn, throughCall, factory, calledElsewhere, wrapped: require("wrapped") };
