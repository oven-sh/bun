// In a sloppy file a function may be the statement of an `if` or stand behind a label. It is `let name = function() {}` in what Bun runs, as in a block: a mock of it takes the name that it has there.
// Its text has no name there. In an executable it keeps the name, which the text of the function around it holds too: the name is not compared.
// Reference: bun build --compile
const { mock } = require("bun:test");

function show(what, f) {
  console.log(what + ":", String(f).replace(/^function[^(]*/, "function").replace(/\s+/g, ""), mock(f).getMockName() === f.name);
}

if (show) function inAnIf() { return 1; }
if (!show) ; else function inAnElse() { return 2; }
label: function behindALabel() { return 3; }
one: two: function behindTwoLabels() { return 4; }
show("the statement of an if", inAnIf);
show("the statement of an else", inAnElse);
show("behind a label", behindALabel);
show("behind two labels", behindTwoLabels);
function around() {
  label: function behindALabelInAFunction() { return 5; }
  show("behind a label in a function", behindALabelInAFunction);
  label: { function inALabelledBlock() { return 6; } }
  show("in a labelled block", inALabelledBlock);
  if (eval("7")) function behindEvalInTheTest() { return 8; }
  show("the statement of an if, eval in the test", behindEvalInTheTest);
}
around();
{
  function twice() { return 9; }
  function twice() { return 10; }
  show("declared twice", twice);
}
show("declared twice, behind the block", twice);
{
  function namedOnlyBehindItsBlock() { return 11; }
}
show("named only behind its block", namedOnlyBehindItsBlock);
