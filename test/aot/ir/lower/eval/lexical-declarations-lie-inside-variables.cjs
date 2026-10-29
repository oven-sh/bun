// RUN(CONST): link
// CONST: evalscope [[scope]] mode=Sloppy {{*}}{name="fixed" kind=Constant layout=
// RUN(LET): link
// LET: evalscope [[scope]] mode=Sloppy {{*}}{name="changed" layout=
// RUN(CLASS): link
// CLASS: evalscope [[scope]] mode=Sloppy {{*}}{name="Made" layout=
// RUN(PARAMETER): link
// PARAMETER: evalscope [[scope]] mode=Sloppy {{*}}{name="parameter" kind=MappedArgument depth=1 field=
// RUN(VAR): link
// VAR: evalscope [[scope]] mode=Sloppy {{*}}{name="variable" depth=1 layout=
// RUN(FUNCTION): link
// FUNCTION: evalscope [[scope]] mode=Sloppy {{*}}{name="declared" depth=1 layout=
// RUN(VARIABLES): link
// VARIABLES: evalscope [[scope]] mode=Sloppy {{*}}{kind=EvalVariables depth=1 operand=

function f(parameter) {
  let changed = 2;
  const text = "var added";
  const result = eval(text);
  const fixed = 1;
  class Made {}
  var variable = 3;
  function declared() {}
  return [result, () => [fixed, changed++, Made, parameter++, variable++, declared]];
}

module.exports = f;
