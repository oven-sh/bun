const mark = Bun.nanoseconds;
const f = () => {};
mark();
mark(); // 1: empty
const p = globalThis.process;
mark(); // 2: first access of process
const q = globalThis.process;
mark(); // 3: second access
const on = p.on;
mark(); // 4: first read of process.on
p.on("x", f);
mark(); // 5: first on()
p.emit("x", 1);
mark(); // 6: first emit()
p.off("x", f);
mark(); // 7: first off()
p.on("SIGINT", f);
p.off("SIGINT", f);
mark(); // 8: on() and off() of a signal
p.on("x", f);
p.emit("x", 1);
p.off("x", f);
mark(); // 9: on, emit, off again
