const marks = [];
function mark(text) { marks.push(text); }
function refuse(tag) { mark(tag + " refuses"); throw new Error(tag + " refused"); }
function deeper(tag) { return deeper(tag + "") + 1; }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
async function callee(tag) { mark(tag + " in"); return tag.endsWith("1") ? { then(resolve) { mark(tag + " then called"); resolve(tag + " from then"); } } : [tag]; }
async function* pieces() { for (let i = 0; i < 3; i++) { mark("makes " + i); yield await callee("a" + i); mark("made " + i); } }
async function outer() { await null; const steps = pieces(); const asked = [steps.next(), steps.next(), steps.next(), steps.next()]; mark("asked"); for (const one of asked) { try { const step = await one; mark("got " + String(step.value) + " " + step.done); } catch (error) { mark("step failed " + error.message); } } }
async function other() { for (let turn = 0; turn < 10; turn++) { mark("other " + turn); await null; } }
other();
outer().then(() => mark("outer done"), error => mark("outer failed " + error.message)); mark("main behind outer");
setTimeout(() => console.log(marks.join("\n")), 40);
