const marks = [];
function mark(text) { marks.push(text); }
function refuse(tag) { mark(tag + " refuses"); throw new Error(tag + " refused"); }
function deeper(tag) { return deeper(tag + "") + 1; }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function awaited(tag) { return tag; }
async function callee(tag) { mark(tag + " in"); return deeper(tag); }

async function outer() {  const made = callee("a"); mark("behind the call"); const got = await made; mark("after " + String(got)); }

Promise.resolve().then(() => { outer().then(() => mark("outer done"), error => mark("outer failed " + error.message)); mark("reaction behind outer"); });
setTimeout(() => console.log(marks.join("\n")), 40);
