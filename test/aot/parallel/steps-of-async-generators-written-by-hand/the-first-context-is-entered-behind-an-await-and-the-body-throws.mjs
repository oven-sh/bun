import { AsyncLocalStorage } from "node:async_hooks";
const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
const storage = new AsyncLocalStorage(), others = [];
function seen() { return String(storage.getStore()) + others.map(one => " " + one.getStore()).join(""); }
async function* inner(tag) { await null; storage.enterWith(tag + " inner entered"); yield tag + " inner 0"; yield tag + " inner 1"; }
async function* pieces(tag) { await null; storage.enterWith(tag + " entered"); throw new Error(tag + " failed"); }
async function outer() { await new Promise(resolve => setTimeout(resolve, 1)); const steps = pieces("a"); for (let turn = 0; turn < 4; turn++) { try { const step = await steps.next(); mark("got " + show(step) + " in " + seen()); if (step.done) break; } catch (error) { mark("caught " + error.message + " in " + seen()); } } await null; mark("a turn on in " + seen()); }
outer().then(() => mark("done in " + seen())); mark("main behind outer in " + seen());
setTimeout(() => console.log(marks.join("\n")), 60);
