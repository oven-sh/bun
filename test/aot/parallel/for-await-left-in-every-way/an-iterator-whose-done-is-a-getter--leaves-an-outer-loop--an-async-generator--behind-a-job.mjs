const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { const n = ++i; return { get done() { mark("done read " + n); return n > 3; }, get value() { mark("value read " + n); return n; } }; }, return() { mark("return"); return {}; } }; }
async function* walk() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of make()) { mark("got " + String(value)); if (++turns === 2) break outer; } mark("behind the loop"); yield round; } return "ended"; }
async function consume() { let last; for (;;) { const step = await walk.made.next(); if (step.done) return step.value; last = step.value; } }
walk.made = walk();
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
await null;
const ended = consume().then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
await ended; await later(0); await later(0); console.log(marks.join("\n"));
