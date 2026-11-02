// Untyped code in a Worker uses its global scope by every name: a bare `onmessage = ..`, self.onmessage, globalThis.onmessage, postMessage bare and as a member, addEventListener with a function, an object, once, a signal; what `this`, event.target, event.ports and event.data are.
const { isMainThread } = require("node:worker_threads");

if (isMainThread) {
  (async () => {
    for (const mode of ["bare", "self", "globalThis", "listener", "object", "once", "signal", "two", "removed", "replaced", "facts"]) {
      const worker = new Worker(__filename, { env: { MODE: mode } });
      const heard = [];
      worker.onmessage = event => heard.push(event.data);
      const closed = new Promise(resolve => worker.addEventListener("close", resolve));
      const { port1, port2 } = new MessageChannel();
      worker.postMessage({ n: 1 });
      worker.postMessage({ n: 2, port: port2 }, [port2]);
      worker.postMessage({ n: 3 });
      worker.postMessage("end");
      await closed;
      port1.close();
      console.log(mode + ":", heard.join(" | "));
    }
  })();
} else {
  const mode = process.env.MODE;
  const say = (who, event, self) => {
    if (event.data === "end") return process.exit(0);
    postMessage(who + " " + event.data.n + " ports=" + event.ports.length + " type=" + event.type + " this=" + (self === globalThis ? "global" : typeof self) + " target=" + (event.target === globalThis ? "global" : typeof event.target));
  };
  if (mode === "bare") {
    onmessage = function (event) { say("bare", event, this); };
  } else if (mode === "self") {
    self.onmessage = function (event) { say("self", event, this); };
  } else if (mode === "globalThis") {
    globalThis.onmessage = event => say("globalThis", event, undefined);
  } else if (mode === "listener") {
    addEventListener("message", function (event) { say("listener", event, this); });
  } else if (mode === "object") {
    const listener = { name: "object", handleEvent(event) { say(this.name, event, this === listener ? globalThis : this); } };
    self.addEventListener("message", listener);
  } else if (mode === "once") {
    addEventListener("message", event => say("once", event), { once: true });
    addEventListener("message", event => event.data === "end" && process.exit(0));
  } else if (mode === "signal") {
    const controller = new AbortController();
    addEventListener("message", event => { say("signal", event); if (event.data.n === 2) controller.abort(); }, { signal: controller.signal });
    addEventListener("message", event => event.data === "end" && process.exit(0));
  } else if (mode === "two") {
    onmessage = event => say("first", event);
    addEventListener("message", event => say("second", event));
  } else if (mode === "removed") {
    const listener = event => say("removed", event);
    addEventListener("message", listener);
    addEventListener("message", event => { if (event.data.n === 1) removeEventListener("message", listener); if (event.data === "end") process.exit(0); });
  } else if (mode === "replaced") {
    onmessage = event => { say("old", event); onmessage = later => say("new", later); };
  } else {
    postMessage([typeof self, self === globalThis, typeof window, typeof postMessage, typeof onmessage, typeof close, typeof importScripts, typeof name, typeof navigator.hardwareConcurrency, typeof Worker, typeof BroadcastChannel, Object.prototype.toString.call(globalThis), typeof require, typeof module, typeof __filename, typeof process.send].join());
    onmessage = event => event.data === "end" && process.exit(0);
  }
}
