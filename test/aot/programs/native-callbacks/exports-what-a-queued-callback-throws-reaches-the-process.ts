// The host's calls of library functions: what a callback of the tick queue, a microtask, an immediate, a timer or an event listener throws is reported by native code to the "uncaughtException" listener, one function for each way.
let bits = 0;

function fromTick(value: number): void { if (typeof value !== "number") bits |= 1; }
function fromMicrotask(value: number): void { if (typeof value !== "number") bits |= 2; }
function fromImmediate(value: number): void { if (typeof value !== "number") bits |= 4; }
function fromTimer(value: number): void { if (typeof value !== "number") bits |= 8; }
function fromListener(value: number): void { if (typeof value !== "number") bits |= 16; }
function fromReaction(value: number): void { if (typeof value !== "number") bits |= 32; }

for (const own of [fromTick, fromMicrotask, fromImmediate, fromTimer, fromListener, fromReaction]) own(1);
process.on("uncaughtException", (thrown: any) => thrown("text"));
process.on("unhandledRejection", (thrown: any) => thrown("text"));
process.nextTick(() => { throw fromTick; });
queueMicrotask(() => { throw fromMicrotask; });
setImmediate(() => { throw fromImmediate; });
setTimeout(() => { throw fromTimer; }, 1);
const target = new EventTarget();
target.addEventListener("e", () => { throw fromListener; });
target.dispatchEvent(new Event("e"));
Promise.resolve().then(() => { throw fromReaction; });
setTimeout(() => console.log(bits.toString(2)), 20);
