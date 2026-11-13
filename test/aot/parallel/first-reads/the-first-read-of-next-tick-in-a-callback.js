// The first read of process.nextTick comes in a callback, outside a microtask. A tick that a microtask then queues waits for the microtasks that are queued, in the first round as in the second.
const round = () =>
  new Promise(done => {
    const nextTick = process.nextTick;
    const order = [];
    queueMicrotask(() => {
      order.push("microtask 1");
      nextTick(() => order.push("tick"));
      queueMicrotask(() => order.push("microtask 2"));
    });
    setImmediate(() => done(order.join(", ")));
  });
setImmediate(async () => {
  console.log("first round:", await round());
  setImmediate(async () => console.log("second round:", await round()));
});
