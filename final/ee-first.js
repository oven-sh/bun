const mark = Bun.nanoseconds;
const f = () => {};
const EE = require("node:events");
const e = new EE();
mark();
mark(); // 1: empty
e.on("x", f);
mark(); // 2: first on()
e.emit("x", 1);
mark(); // 3: first emit()
e.off("x", f);
mark(); // 4: first off()
e.on("x", f);
e.emit("x", 1);
e.off("x", f);
mark(); // 5: again
e.once("x", f);
mark(); // 6: first once
e.emit("x", 1);
mark(); // 7: emit of once
