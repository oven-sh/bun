import { AsyncLocalStorage } from "node:async_hooks";
const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
const storage = new AsyncLocalStorage();
async function* pieces(tag) { for (let i = 0; i < 3; i++) { await null; storage.enterWith(tag + " entered " + i); mark(tag + " awaited in " + storage.getStore()); yield tag + i; } }
async function outer() { await null; const steps = pieces("a"); try { for (;;) { const step = await steps.next(); mark("got " + show(step) + " in " + storage.getStore()); if (step.done) break; } } catch (error) { mark("caught " + error.message + " in " + storage.getStore()); } await null; mark("a turn on in " + storage.getStore()); }
storage.run("main", () => { outer().then(() => mark("done in " + storage.getStore())); mark("main behind outer in " + storage.getStore()); });
setTimeout(() => console.log(marks.join("\n")), 60);
