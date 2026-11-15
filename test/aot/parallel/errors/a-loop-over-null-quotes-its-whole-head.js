// `for (const [a, b] of v)` where `v` is null or undefined: the message quotes the head of the loop from `const` on. Of `for (const x of v)` it quotes `x of v`.
function name(v) { for (const x of v) return [x]; }
function letName(v) { for (let x of v) return [x]; }
function list(v) { for (const [a, b] of v) return [a, b]; }
function letList(v) { for (let [a, b] of v) return [a, b]; }
function varList(v) { for (var [a, b] of v) return [a, b]; }
function listInAList(v) { for (const [[x]] of v) return [x]; }
function object(v) { for (const { a, b } of v) return [a, b]; }
function listInAnObject(v) { for (const { a: [b] } of v) return [b]; }
function objectInAList(v) { for (const [{ a }] of v) return [a]; }
function withADefault(v) { for (const [a = 1, b] of v) return [a, b]; }
function behindAHole(v) { for (const [, b] of v) return [b]; }
function emptyList(v) { for (const [] of v) return []; }
function rest(v) { for (const [...r] of v) return r; }
function assignedName(v) { let x; for (x of v) return [x]; }
function assignedList(v) { let a, b; for ([a, b] of v) return [a, b]; }
function assignedObject(v) { let a; for ({ a } of v) return [a]; }
function assignedMember(v) { const o = {}; for (o.x of v) return [o]; }
function secondLoopOfALine(v) { for (const k of [1]) for (const [a, b] of v) return [a, b]; }
function path(o) { for (const [a, b] of o.p.q) return [a, b]; }
function call(f) { for (const [a, b] of f()) return [a, b]; }
async function awaited(v) { for await (const [a, b] of v) return [a, b]; }
function show(name, run) {
  try {
    console.log(name, "returned", JSON.stringify(run()));
  } catch (error) {
    console.log(name + ":", error.name + ": " + error.message, "at", /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])[1]);
  }
}
const loops = [name, letName, list, letList, varList, listInAList, object, listInAnObject, objectInAList, withADefault, behindAHole, emptyList, rest, assignedName, assignedList, assignedObject, assignedMember, secondLoopOfALine];
// An executable keeps the text of a function that something may ask for it.
globalThis.kept = { loops, path, call, awaited, show };

for (const nothing of [null, undefined]) {
  for (const loop of loops) show(loop.name, () => loop(nothing));
  show("path", () => path({ p: { q: nothing } }));
  show("call", () => call(() => nothing));
  await awaited(nothing).catch(error => console.log("awaited:", error.name + ": " + error.message));
  show("what a declared list is given", () => list([nothing]));
  show("what an assigned list is given", () => assignedList([nothing]));
  show("what a list in a list is given", () => listInAList([[nothing]]));
  show("what a list in an object is given", () => listInAnObject([{ a: nothing }]));
}
show("nothing is wrong", () => [name([1]), list([[1, 2]]), listInAList([[[3]]]), assignedList([[4, 5]]), rest([[6]])]);
