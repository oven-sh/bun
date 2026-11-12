// node:worker_threads: a Worker whose one 'message' listener has removed itself holds what the worker posts, and the next listener gets it in order.
const { Worker, isMainThread, parentPort, workerData, MessageChannel } = require("node:worker_threads");
const { once } = require("node:events");

if (isMainThread) {
  const { port1: side, port2 } = new MessageChannel();
  const worker = new Worker(__filename, { workerData: { side: port2 }, transferList: [port2] });
  // The worker answers on a port made for that one answer: the task of the answer is queued behind the one that drains parentPort's end here.
  const post = async batch => {
    const { port1, port2: ack } = new MessageChannel();
    const acked = once(port1, "message");
    side.postMessage({ batch, ack }, [ack]);
    await acked;
    port1.close();
  };
  (async () => {
    const ready = once(worker, "message");
    await post(["ready"]);
    console.log("the one listener heard:", ...(await ready));
    await post(["a", "b"]);
    await post(["c"]);
    const heard = [];
    const ended = new Promise(resolve =>
      worker.on("message", message => {
        heard.push(message);
        if (message === "end") resolve();
      }),
    );
    await post(["end"]);
    await ended;
    console.log("the next listener heard:", heard.join(" "));
    // Plain Bun is the reference of this program. A message that both lose prints alike, so the program fails by itself.
    if (heard.join(" ") !== "a b c end") throw new Error("a held message did not arrive");
    side.close();
    await worker.terminate();
  })();
} else {
  workerData.side.on("message", ({ batch, ack }) => {
    for (const message of batch) parentPort.postMessage(message);
    ack.postMessage("posted");
  });
}
