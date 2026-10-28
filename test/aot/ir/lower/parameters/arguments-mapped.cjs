// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 {{*}}parameters=[{type=anything}] results=
// CHECK: b0([[callee]]: function, [[count]]: {{*}}, [[a]]: anything, [[rest]]: {{*}}):
// CHECK: [[arguments]] = CreateMappedArguments [[callee]], [[count]], [[rest]], [[a]]
// CHECK: [[read]] = GetMappedArgument [[arguments]] @
// CHECK: Return [[read]]
// CHECK-LABEL: function {{*}}name="second"
// CHECK: [[both]] = CreateMappedArguments
// CHECK: [[last]] = GetMappedArgument [[both]] index=1
// CHECK: Return [[last]]

// RUN(KIND): lower
// KIND-NOT: CreateUnmappedArguments

function f(a) {
  arguments[0] = 1;
  return a;
}

function second(a, b) {
  arguments[1] = 1;
  return b;
}

module.exports = [f, second];
