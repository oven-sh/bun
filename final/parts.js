const mark = Bun.nanoseconds;
const f = () => {};
const p = globalThis.process;
delete p._events.newListener;
delete p._events.removeListener;
mark();
mark(); // 1: empty
const on = p.on;
mark(); // 2: first read of process.on (creates the helpers and the function)
p.on("x", f);
mark(); // 3: first on(), no newListener listener: compiles addListener and its helper
const emit = p.emit;
mark(); // 4: first read of emit: compiles and runs createEmit
p.emit("x", 1);
mark(); // 5: first emit(): compiles emit
p.off("x", f);
mark(); // 6: first off(): compiles removeListener
p.once("x", f);
mark(); // 7: first once()
p.emit("x", 1);
mark(); // 8: emit of a once listener (compiles the wrapper, removeListener is compiled)
