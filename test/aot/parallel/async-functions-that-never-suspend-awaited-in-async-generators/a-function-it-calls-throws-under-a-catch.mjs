const marks = [];
function mark(text) { marks.push(text); }
function refuse(tag) { mark(tag + " refuses"); throw new Error(tag + " refused"); }
function deeper(tag) { return deeper(tag + "") + 1; }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
async function callee(tag) { mark(tag + " in"); const got = refuse(tag); mark(tag + " never"); return got; }
async function* pieces() { for (let i = 0; i < 3; i++) { try { yield await callee("a" + i); } catch (error) { mark("caught " + error.message); yield "c" + i; } } }
async function outer() { await null; for await (const piece of pieces()) mark("got " + String(piece)); }
async function other() { for (let turn = 0; turn < 10; turn++) { mark("other " + turn); await null; } }
other();
outer().then(() => mark("outer done"), error => mark("outer failed " + error.message)); mark("main behind outer");
setTimeout(() => console.log(marks.join("\n")), 40);
