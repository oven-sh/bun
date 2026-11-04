// RUN: link
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=[[f]] flags=[IsFromCompiler]} initialization=Function function=[[f]]
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: function [[inner]] name="inner" module=[[entry]]
// CHECK: function [[arrow]] module=[[entry]] {{*}}kind=Arrow {{*}}captures=[{type=[[inner]] flags=[IsFromCompiler] variableName="inner"}]

export function f() {}

export function outer() {
  function inner() {}
  return () => inner;
}
