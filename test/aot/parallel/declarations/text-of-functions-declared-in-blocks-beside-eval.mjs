// A function declared in a block is `let name = function() {}` in what Bun runs, so a mock of it takes no name, but not where the block holds a direct eval, which may look for the name.
// Its text has no name there. In an executable it keeps the name, which the text of the function around it holds too: the name is not compared.
import { mock } from "bun:test";

function show(what, f) {
  console.log(what + ":", String(f).replace(/^function[^(]*/, "function").replace(/\s+/g, ""), JSON.stringify([f.name, mock(f).getMockName()]));
}

{
  function besideEval() { return 1; }
  show("beside a direct eval", besideEval);
  console.log(eval("besideEval()"));
}
{
  function aroundEval(a) { return eval("a + 1"); }
  show("around a direct eval", aroundEval);
}
{
  function besideAClosureWithEval() { return 2; }
  show("beside a closure with a direct eval", besideAClosureWithEval);
  console.log((() => { { return eval("besideAClosureWithEval()"); } })());
}
function evalOutsideTheBlock() {
  {
    function inABlockBesideWhichEvalStands() { return 3; }
    show("eval stands outside the block", inABlockBesideWhichEvalStands);
  }
  return eval("4");
}
console.log(evalOutsideTheBlock());
{
  function besideIndirectEval() { return 5; }
  show("beside an indirect eval", besideIndirectEval);
  console.log((0, eval)("6"), eval?.("7"), globalThis.eval("8"));
}
switch (eval("9")) {
  case 9:
    function behindEvalInTheSubject() { return 10; }
    show("eval in the subject of a switch", behindEvalInTheSubject);
}
switch (11) {
  case eval("11"):
    function behindEvalInATest() { return 12; }
    show("eval in the test of a clause", behindEvalInATest);
}
