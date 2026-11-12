const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
async function* pieces(tag) { mark(tag + " starts"); for (let i = 0; i < 3; i++) { const sent = yield tag + i; mark(tag + " was sent " + String(sent)); } mark(tag + " ends"); return tag + " result"; }
async function outer() { await null; const steps = pieces("a"); mark("got " + show(await steps.next())); pieces.prototype.next = function (sent) { mark("next of the prototype"); return { value: "no promise", done: true }; }; mark("got " + show(await steps.next())); delete pieces.prototype.next; mark("got " + show(await steps.next())); }
outer();
setTimeout(() => console.log(marks.join("\n")), 60);
