import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* inner() { yield 0; }
async function* mine() { als.enterWith("x"); yield 0; }
async function* graphThenContext() { await 0; new Bun.ModuleGraph(); als.enterWith("in"); yield 1; }
async function* graphThenStep() { await 0; new Bun.ModuleGraph(); await inner().next(); als.enterWith("in"); yield 1; }
async function* graphThenStepThatEnters() { await 0; new Bun.ModuleGraph(); await mine().next(); yield 1; }
async function* graphThenForAwait() { await 0; new Bun.ModuleGraph(); for await (const x of inner()); als.enterWith("in"); yield 1; }
async function* noAwaitInFront() { als.enterWith("in"); yield 1; }
async function* anAwaitInFront() { await 0; als.enterWith("in"); yield 1; }
async function read1() { await 0; const r = await graphThenContext().next(); return "a graph, a context, a yield: " + r.value + " " + s(); }
async function read2() { await 0; const r = await graphThenStep().next(); return "a graph, a step, a context, a yield: " + r.value + " " + s(); }
async function read3() { await 0; const r = await graphThenStepThatEnters().next(); return "a graph, a step that enters a context: " + r.value + " " + s(); }
async function read4() { await 0; const r = await graphThenForAwait().next(); return "a graph, for await, a context: " + r.value + " " + s(); }
async function read5() { await 0; const r = await noAwaitInFront().next(); return "no await in front: " + r.value + " " + s(); }
async function read6() { await 0; const r = await anAwaitInFront().next(); return "an await in front: " + r.value + " " + s(); }
const inTimer = read => new Promise(done => setTimeout(() => read().then(done), 1));
export async function readAll(say) {
  say(await inTimer(read1));
  say(await inTimer(read2));
  say(await inTimer(read3));
  say(await inTimer(read4));
  say(await inTimer(read5));
  say(await inTimer(read6));
}
