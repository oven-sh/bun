const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 3, value: ++i }; }, async return() { mark("return gives 7"); return 7; } }; }
async function consume() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of make()) { mark("got " + String(value)); if (++turns === 2) continue outer; } mark("behind the loop"); } return "ended"; }
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
await null;
const ended = consume().then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
await ended; await later(0); await later(0); console.log(marks.join("\n"));
