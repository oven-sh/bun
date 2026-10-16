// two unhandled rejections; the handler queues a tick each time. Order of handler calls and ticks?
const ev = [];
process.on("unhandledRejection", err => { ev.push("handler " + err.message); process.nextTick(() => ev.push("tick " + err.message)); queueMicrotask(() => ev.push("microtask " + err.message)); });
Promise.reject(new Error("A"));
Promise.reject(new Error("B"));
setTimeout(() => console.log(ev.join(", ")), 20);
