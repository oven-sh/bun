// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}} length=2 {{*}}parameters=[{type=anything}, {type=anything}]
// CHECK: b0([[first]]: anything, [[last]]: anything):
// CHECK: Return [[last]]

function f(a, a) {
  return a;
}

module.exports = f;
