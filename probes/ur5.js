// no timer: does anything queued by the handler run before exit?
process.on("unhandledRejection", err => { require("fs").writeSync(1, "handler " + err.message + "\n"); process.nextTick(() => require("fs").writeSync(1, "tick " + err.message + "\n")); });
Promise.reject(new Error("A"));
Promise.reject(new Error("B"));
