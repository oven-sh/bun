const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
const shared = { i: 0, [Symbol.asyncIterator]() { return this; }, async next() { return { done: this.i >= 3, value: ++this.i }; }, return() { mark("return"); return {}; } };
function make() { shared.i = 0; return shared; }
function meddle() { shared.next = async function () { mark("the other next"); return { done: true }; }; }
async function consume() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of make()) { mark("got " + String(value)); if (typeof meddle === "function") meddle(); } mark("behind the loop"); } return "ended"; }
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
await null;
const ended = consume().then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
await ended; await later(0); await later(0); console.log(marks.join("\n"));
