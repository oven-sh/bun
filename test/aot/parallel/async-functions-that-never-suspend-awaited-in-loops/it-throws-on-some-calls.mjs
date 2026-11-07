const marks = [];
function mark(text) { marks.push(text); }
function refuse(tag) { mark(tag + " refuses"); throw new Error(tag + " refused"); }
function deeper(tag) { return deeper(tag + "") + 1; }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
function awaited(tag) { return tag; }
async function callee(tag) { mark(tag + " in"); if (tag.endsWith("1") || tag === "b") throw new Error(tag + " failed"); return tag; }

async function outer() {  for (let i = 0; i < 3; i++) mark("after " + String(await callee("a" + i))); }
async function other() { for (let turn = 0; turn < 8; turn++) { mark("other " + turn); await null; } }
other();
Promise.resolve().then(() => { outer().then(() => mark("outer done"), error => mark("outer failed " + error.message)); mark("reaction behind outer"); });
setTimeout(() => console.log(marks.join("\n")), 40);
