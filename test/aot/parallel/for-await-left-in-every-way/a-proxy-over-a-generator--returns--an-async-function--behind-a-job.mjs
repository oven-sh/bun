const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
async function* inner() { yield 1; yield 2; }
function make() { const made = inner(); return new Proxy(made, { get(target, key) { mark("get " + String(key)); const found = target[key]; return typeof found === "function" ? found.bind(target) : found; } }); }
async function consume() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of make()) { mark("got " + String(value)); if (++turns === 2) return "returned"; } mark("behind the loop"); } return "ended"; }
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
await null;
const ended = consume().then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
await ended; await later(0); await later(0); console.log(marks.join("\n"));
