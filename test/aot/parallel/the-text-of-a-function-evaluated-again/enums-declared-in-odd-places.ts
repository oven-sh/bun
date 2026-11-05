// An enum in the body of a loop, under a case, in try, catch and finally, in a generator, an async function, an arrow, and one function deeper.
let calls = 0;
function next() { return ++calls; }
function inLoop() { const seen: unknown[] = []; for (let round = 0; round < 3; round++) { enum Turn { Now = next(), Fixed = 5 } seen.push(Turn.Now, Turn[Turn.Now], Turn.Fixed); } return seen; }
function underCase(x: number) { switch (x) { case 1: { enum One { A = 1 } return One[1]; } default: { enum Other { B = next() } return Object.keys(Other).length; } } }
function aroundErrors() { const seen: unknown[] = []; try { enum Tried { T = next() } seen.push(typeof Tried.T); throw 1; } catch { enum Caught { C = "c" } seen.push(Caught.C); } finally { enum Last { L = next(), M } seen.push(Last.M - Last.L, Last[Last.M]); } return seen; }
function* stepwise() { enum Step { A = 1, B = next() } yield Step[1]; yield typeof Step.B; }
async function later() { enum Wait { W = next() } return typeof (await Wait.W); }
const arrow = () => { enum Small { S = -2 } return [Small.S, Small[-2]]; };
function outer() { return function inner() { enum Deep { D = next(), E = D * 0 + 4 } return [Deep.E, Deep[4]]; }; }
const again = (made: Function): any => (0, eval)("(function (next) { return (" + String(made) + "); })")(next);
const show = (label: string, value: unknown) => console.log(label, JSON.stringify(value));
for (const pick of [(made: Function): any => made, again]) {
  calls = 0;
  show("loop", pick(inLoop)());
  show("case", [pick(underCase)(1), pick(underCase)(2)]);
  show("errors", pick(aroundErrors)());
  show("generator", [...pick(stepwise)()]);
  show("async", await pick(later)());
  show("arrow", pick(arrow)());
  show("deeper", [pick(outer)()(), pick(outer())()]);
}
