// One compiled file runs as a Worker of node:worker_threads and as a Web Worker. The first has none of self, onmessage, onerror, postMessage, addEventListener, removeEventListener and dispatchEvent, as in Node, and the second has them all: so the build decides nothing from their being there. Each name is asked for by typeof, by `in`, as a member, by a bare read, by a call behind a test, and is stored to.
import { Worker as NodeWorker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const node = new Promise(resolve => {
    const told = [];
    const worker = new NodeWorker(new URL(import.meta.url));
    worker.on("message", message => told.push(message));
    worker.on("error", error => told.push("error: " + error.message));
    worker.on("exit", code => resolve(told.join("\n") + "\nexit " + code));
  });
  console.log("a Worker of node:worker_threads\n" + (await node));
  const web = new Promise(resolve => {
    const told = [];
    const worker = new Worker(import.meta.url);
    worker.onmessage = event => told.push(event.data);
    worker.onerror = event => told.push("error: " + event.message);
    worker.addEventListener("close", event => resolve(told.join("\n") + "\nclose " + event.code));
  });
  console.log("a Web Worker\n" + (await web));
} else {
  const names = [
    "self",
    "onmessage",
    "onerror",
    "postMessage",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
  ];
  const told = [];
  const attempt = (label, action) => {
    try {
      told.push(label + ": " + action());
    } catch (error) {
      told.push(label + ": " + error.name + ": " + error.message);
    }
  };
  attempt("typeof", () =>
    [
      typeof self,
      typeof onmessage,
      typeof onerror,
      typeof postMessage,
      typeof addEventListener,
      typeof removeEventListener,
      typeof dispatchEvent,
    ].join(),
  );
  attempt("in", () => names.map(name => name in globalThis).join());
  attempt("members", () =>
    [
      typeof globalThis.self,
      typeof globalThis.onmessage,
      typeof globalThis.onerror,
      typeof globalThis.postMessage,
      typeof globalThis.addEventListener,
      typeof globalThis.removeEventListener,
      typeof globalThis.dispatchEvent,
    ].join(),
  );
  attempt("own names", () =>
    Object.getOwnPropertyNames(globalThis)
      .filter(name => names.includes(name))
      .sort()
      .join(),
  );
  attempt("self", () => self === globalThis);
  attempt("onmessage", () => onmessage);
  attempt("onerror", () => onerror);
  attempt("postMessage", () => postMessage.length);
  attempt("addEventListener", () => addEventListener.length);
  attempt("removeEventListener", () => removeEventListener.length);
  attempt("dispatchEvent", () => dispatchEvent.length);
  attempt("a call behind a test", () =>
    typeof addEventListener === "function" ? (addEventListener("told", () => {}), "called") : "left out",
  );
  attempt("what a library takes the thread for", () =>
    typeof self !== "undefined" && typeof postMessage === "function" && typeof addEventListener === "function"
      ? "a Web Worker"
      : "a Worker of node",
  );
  const port = parentPort;
  attempt(
    "a store to a member",
    () => (
      (globalThis.dispatchEvent = 1),
      typeof dispatchEvent + " " + JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "dispatchEvent"))
    ),
  );
  attempt("a store to a name", () => ((removeEventListener = 2), typeof removeEventListener));
  attempt("a store to a handler", () => ((globalThis.onerror = 3), String(onerror)));
  port.postMessage(told.join("\n"));
}
