globalThis.__handedOn = value => console.log("handed on:", value);
queueMicrotask(() => globalThis.__handedOn("a microtask"));
setTimeout(globalThis.__handedOn, 1, "a timer");
process.once("exit", () => globalThis.__handedOn("exit"));
const target = new EventTarget();
target.addEventListener("ping", event => globalThis.__handedOn(event.type));
target.dispatchEvent(new Event("ping"));
