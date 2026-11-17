const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
async function* pieces(tag) { mark(tag + " starts"); for (let i = 0; i < 3; i++) { const sent = yield tag + i; mark(tag + " was sent " + String(sent)); } mark(tag + " ends"); return tag + " result"; }
async function outer() { await null; const steps = pieces("a"); for (let turn = 0; turn < 4; turn++) { const step = await steps.next((turn === 1 && (steps.next = () => ({ value: "replaced", done: true })), "s" + turn)); mark("got " + show(step)); if (step.done) break; } }
outer();
setTimeout(() => console.log(marks.join("\n")), 60);
