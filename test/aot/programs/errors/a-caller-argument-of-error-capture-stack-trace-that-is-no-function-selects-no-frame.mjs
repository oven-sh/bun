// Error.captureStackTrace(target, caller) looks for `caller` on the stack only if it is a function. A bound function, a Proxy and a value that is not callable select no frame, so the trace starts at the function that captures.
const names = stack => String(stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(?[^ ()]*:\d+:\d+\)?$/, "").replace(/ \(native\)$/, "") || "<anonymous>").slice(0, 3).join(" < ");
function capture(caller) { const o = {}; Error.captureStackTrace(o, caller); return names(o.stack); }
function outer(caller) { return capture(caller) + ""; }
function top(caller) { return outer(caller) + ""; }
const say = (label, value) => console.log(label + ": " + value);

say("no caller", top());
say("the function that captures", top(capture));
say("its caller", top(outer));
say("a function that is not on the stack", JSON.stringify(top(function other() {})));
say("an object", top({}));
say("an array", top([]));
say("a number", top(5));
say("a text", top("outer"));
say("a bound function that is on the stack", top(outer.bind(null)));
say("a bound function of the function that captures", top(capture.bind(null)));
say("a bound function that is not on the stack", top(function other() {}.bind(null)));
say("a Proxy of a function that is on the stack", top(new Proxy(outer, {})));

const calledBound = function boundTarget() { return capture(calledBound) + ""; }.bind(null);
say("a bound function, called", calledBound());

class Self { constructor() { Error.captureStackTrace(this, this); } }
function makeSelf() { const made = new Self(); return [made][0]; }
say("this in a constructor", names(makeSelf().stack));
class Failure { constructor() { Error.captureStackTrace(this, Failure); } }
function makeFailure() { const made = new Failure(); return [made][0]; }
say("the class in its constructor", names(makeFailure().stack));

async function resumed(caller) { await 0; return capture(caller) + ""; }
async function awaits(caller) { return (await resumed(caller)) + ""; }
say("a resumed async function", await awaits(resumed));
say("a bound function of a resumed async function", await awaits(resumed.bind(null)));

say("a built-in function that is on the stack", [0].map(() => capture(Array.prototype.map) + "")[0]);
say("a bound built-in function", [0].map(() => capture(Array.prototype.map.bind([])) + "")[0]);
