const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
function* make() { try { yield 1; yield Promise.reject(new Error("rejected")); yield 3; } finally { mark("cleans up"); } }
async function consume() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of make()) { mark("got " + String(value)); } mark("behind the loop"); } return "ended"; }
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
await later(0);
const ended = consume().then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
await ended; await later(0); await later(0); console.log(marks.join("\n"));
