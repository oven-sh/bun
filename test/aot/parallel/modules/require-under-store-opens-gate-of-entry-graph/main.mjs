// The entry point is an ES module whose graph has two top-level awaits. No store of AsyncLocalStorage is set when it loads. A callback of setImmediate() calls require() under a store, and the required module settles the promise that the first await waits for. The modules that wait run later: the entry point and what it leaves for later read no store.
import "./setup.cjs";
import "./waits-again.mjs";
see("main");
setImmediate(() => see("what main left for later"));
Promise.resolve().then(() => see("a reaction that main queued"));
