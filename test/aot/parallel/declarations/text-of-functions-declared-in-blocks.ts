// A function declared in a block is `let name = function() {}` in what Bun runs: a mock of it takes no name. Its own `name` stays.
// Its text has no name there. In an executable it keeps the name, which the text of the function around it holds too: the name is not compared.
import { mock } from "bun:test";

function show(what: string, f: Function) {
  console.log(what + ":", String(f).replace(/^function[^(]*/, "function").replace(/\s+/g, ""), JSON.stringify([f.name, mock(f as () => void).getMockName()]));
}
function used(...functions: Function[]) {
  return functions.length;
}

{
  function inABlock(a: number) { return a + 1; }
  show("a block", inABlock);
}
function atTheTop(a: number) { return a + 1; }
show("the top of the file", atTheTop);
function around() {
  function inAFunction(a: number) { return a + 1; }
  show("the body of a function", inAFunction);
  {
    function inABlockOfAFunction(a: number) { return a + 1; }
    show("a block in a function", inABlockOfAFunction);
    {
      function twoBlocksDeep(a: number) { return inABlockOfAFunction(a); }
      show("two blocks deep", twoBlocksDeep);
    }
  }
}
around();
if (used()) {
  function inAnArm(a: number) { return a + 1; }
  show("an arm of if", inAnArm);
} else {
  function inTheOtherArm(a: number) { return a + 1; }
  show("the other arm", inTheOtherArm);
}
for (let i = 0; i < 2; i++) {
  function inALoop(a: number) { return a + i; }
  show("a loop", inALoop);
}
switch (used()) {
  case 0:
    function inAClause(a: number) { return a + 1; }
    show("a clause", inAClause);
}
try {
  function inATry(a: number) { return a + 1; }
  show("try", inATry);
  throw 1;
} catch {
  function inACatch(a: number) { return a + 1; }
  show("catch", inACatch);
} finally {
  function inAFinally(a: number) { return a + 1; }
  show("finally", inAFinally);
}
{
  async function asynchronous(a: number) { return a + 1; }
  function* generator(a: number) { yield a + 1; }
  async function* both(a: number) { yield a + 1; }
  show("async", asynchronous);
  show("a generator", generator);
  show("an async generator", both);
}
{
  function   manyBlanks   (a: number) { return a + 1; }
  function /* before */ withComments /* behind */ (a: number) { return a + 1; }
  function
  onItsOwnLine
  (a: number) { return a + 1; }
  function escaped(a: number) { return a + 1; }
  function $(a: number) { return a + 1; }
  show("many blanks", manyBlanks);
  show("comments", withComments);
  show("on its own line", onItsOwnLine);
  show("an escape", escaped);
  show("one character", $);
}
{
  function generic<T extends object>(this: any, a: T): T { return a; }
  function overloaded(a: number): number;
  function overloaded(a: string): string;
  function overloaded(a: any): any { return a; }
  show("type parameters", generic);
  show("overloads", overloaded);
}
{
  function callsItself(a: number): string { return a ? callsItself(a - 1) : String(callsItself).replace(/^function[^(]*/, "function").replace(/\s+/g, ""); }
  console.log("calls itself:", callsItself(2));
}
class Kind {
  static {
    function inAStaticBlock(a: number) { return a + 1; }
    show("a static block", inAStaticBlock);
    {
      function inABlockOfAStaticBlock(a: number) { return a + 1; }
      show("a block in a static block", inABlockOfAStaticBlock);
    }
  }
  method() {
    {
      function inABlockOfAMethod(a: number) { return a + 1; }
      show("a block in a method", inABlockOfAMethod);
    }
  }
}
new Kind().method();
const arrow = () => {
  function inAnArrow(a: number) { return a + 1; }
  show("the body of an arrow", inAnArrow);
  {
    function inABlockOfAnArrow(a: number) { return a + 1; }
    show("a block in an arrow", inABlockOfAnArrow);
  }
};
arrow();
namespace Space {
  function inANamespace(a: number) { return a + 1; }
  export function exported(a: number) { return a + 1; }
  show("a namespace", inANamespace);
  show("exported from a namespace", exported);
  {
    function inABlockOfANamespace(a: number) { return a + 1; }
    show("a block in a namespace", inABlockOfANamespace);
  }
}
{
  function sent(a: number) { return a + 1; }
  console.log("evaluated from its text:", (0, eval)("(" + sent + ")")(1));
}
// What stands behind the name in its line is still quoted, and found, where it is written.
{
  function thrower(o: any) { function inner(p: any) { return p.a.b.c; } return inner(o); } try { thrower({}); } catch (error: any) { console.log(error.message, error.stack.split("\n")[1].replace(/\(.*[\\/]/, "(")); }
}
// Text that is evaluated runs as it is written.
console.log("in evaluated text:", (0, eval)("{ function inEvaluatedText(a) { return a + 1; } String(inEvaluatedText) }"));
