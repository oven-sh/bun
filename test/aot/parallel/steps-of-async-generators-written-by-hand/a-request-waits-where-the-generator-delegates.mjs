const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
let self;
async function* inner(tag) { yield tag + " i0"; Promise.resolve().then(() => mark(tag + " job behind i0")); yield tag + " i1"; Promise.resolve().then(() => mark(tag + " job behind i1")); }
async function* pieces(tag) { self.next("x").then(step => mark("queued " + show(step))); yield* inner(tag); }
async function outer() { await new Promise(resolve => setTimeout(resolve, 1)); const steps = self = pieces("a"); for (let turn = 0; turn < 4; turn++) { const step = await steps.next("s" + turn); mark("got " + show(step)); } }

outer().then(() => mark("outer done")); mark("main behind outer");
setTimeout(() => console.log(marks.join("\n")), 60);
