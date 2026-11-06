// RUN: link
// CHECK: layout [[environment]] kind=Environment {{*}}declared={type=anything
// CHECK: function {{*}}name="initialized" module=[[entry]]
// CHECK: function [[arrow]] module=[[entry]] {{*}}kind=Arrow {{*}}captures=[{type=env [[environment]] flags=[IsFromCompiler]}]

// RUN(DECLARED): lower
// DECLARED: function [[f]] name="f"
// DECLARED: function {{*}}kind=Arrow {{*}}captures=[{type=[[f]] flags=[IsFromCompiler]}]

export function declared() {
  var f;
  function f() {}
  return () => f;
}

export function initialized() {
  var f = 1;
  function f() {}
  return () => f;
}
