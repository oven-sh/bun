const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
async function* pieces(tag) { mark(tag + " starts"); for (let i = 0; i < 3; i++) { const sent = yield tag + i; mark(tag + " was sent " + String(sent)); } mark(tag + " ends"); return tag + " result"; }
function change(step) { step.value = "changed by a function"; step.done = undefined; }
function keyOf(left, right) { return left + right; }
async function outer() {  const steps = pieces("a"); { const step = await steps.next(); mark("read " + String(step.value) + " " + String(step.done)); change(step); mark("read again " + String(step.value) + " " + String(step.done)); } }
outer().then(() => mark("outer done"), error => mark("outer failed " + error.message));
setTimeout(() => console.log(marks.join("\n")), 60);
