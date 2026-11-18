const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function show(step) { return String(step.value) + (step.done ? " done" : ""); }
let self;
function askFromOutside() { self.next("o").then(step => mark("asked from outside " + show(step)), error => mark("asked from outside failed " + error.message)); }
async function* pieces(tag) { yield tag + 0; self.next("x").then(step => mark("queued one " + show(step)), error => mark("queued one failed " + error.message)); self.next("y").then(step => mark("queued two " + show(step)), error => mark("queued two failed " + error.message)); mark(tag + " returns"); return tag + " result"; }
async function outer() { await new Promise(resolve => setTimeout(resolve, 1)); self = pieces("a"); for (let turn = 0; turn < 5; turn++) { try { mark("got " + show(await self.next("s" + turn))); } catch (error) { mark("caught " + error.message); } } }

outer().then(() => mark("outer done")); mark("main behind outer");
setTimeout(() => console.log(marks.join("\n")), 60);
