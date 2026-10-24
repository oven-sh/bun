// A store in a function that is called once, which suspends in front of it.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
var box;
(async function () { await null; box = { a: 1 }; })();
console.log(attempt(() => box.a));
await null; await null;
console.log(attempt(() => box.a));
