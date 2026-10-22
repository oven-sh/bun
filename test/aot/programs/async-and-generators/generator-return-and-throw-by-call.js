// return() and throw() of %GeneratorPrototype%, called with .call on started and unstarted generators: the two must not be swapped.
function* g() { try { yield 1; yield 2; } finally { console.log("finally"); } }
const prototype = Object.getPrototypeOf(g.prototype);
const started = g(); started.next();
console.log(JSON.stringify(prototype.return.call(started, 7)));
const thrown = g(); thrown.next();
try { prototype.throw.call(thrown, new Error("thrown")); } catch (error) { console.log("caught", error.message); }
console.log(JSON.stringify(prototype.return.call(g(), 8)));
try { prototype.throw.call(g(), new Error("unstarted")); } catch (error) { console.log("caught", error.message); }
try { prototype.next.call({}); } catch (error) { console.log(error instanceof TypeError); }
