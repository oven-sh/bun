// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: [[closure]] = NewClosure
// CHECK-NEXT: [[inner]] = Convert [[closure]] declared={type=f{{*}} flags=[IsFromCompiler]}
// CHECK-NEXT: Return [[inner]]
// CHECK-LABEL: function {{*}}name="inner"

// RUN(BOUND): lower
// BOUND-LABEL: function {{*}}name="outer"
// BOUND-NOT: isFreeName
// BOUND-LABEL: function {{*}}name="inner"

function outer() {
  {
    function inner() {}
  }
  return inner;
}

module.exports = outer;
