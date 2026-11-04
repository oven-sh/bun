// the variable is given another function by the function that it holds, in the middle of a call of it, and by a getter that runs between two calls
let hook = () => "start";
function setHook(f) { hook = f; }
function call() { return hook(); }
function later(tag) { return () => tag; }
const seen = [];
for (let i = 0; i < 4; i++) seen.push(call());
setHook(function self() { setHook(later("behind")); return "self"; });
for (let i = 0; i < 3; i++) seen.push(call());
setHook(later("again"));
const o = { get x() { setHook(later("by a getter")); return 1; } };
seen.push(call(), o.x, call());
hook = undefined;
try { call(); } catch (e) { seen.push(e.name); }
hook = later;
seen.push(typeof call());
console.log(seen.join());
