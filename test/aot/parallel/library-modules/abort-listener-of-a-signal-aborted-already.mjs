// events.addAbortListener() on a signal that is aborted already: the listener gets a trusted abort event that names the signal, dispose() stops the call, and an object that is no AbortSignal gets the call with no argument.
import { addAbortListener } from "node:events";

const turn = () => new Promise(resolve => setImmediate(resolve));
const describe = (event, signal) =>
  `${event.type} trusted ${event.isTrusted} target ${event.target === signal} currentTarget ${event.currentTarget === signal} srcElement ${event.srcElement === signal} phase ${event.eventPhase}`;

const signal = AbortSignal.abort("why");
let kept;
addAbortListener(signal, function (event) {
  if (event?.target !== signal) throw new Error("the listener got no event that names its signal");
  kept = event;
  console.log("during:", arguments.length, describe(event, signal), "reason", event.target.reason);
});
addAbortListener(signal, () => console.log("a disposed listener ran"))[Symbol.dispose]();
await turn();
console.log("after:", describe(kept, signal), "own names", Object.getOwnPropertyNames(kept).join());

const other = new EventTarget();
other.addEventListener("abort", event => console.log("dispatched again:", event === kept, event.target === other));
console.log("dispatch returns", other.dispatchEvent(kept), "target is the signal", kept.target === signal);

addAbortListener({ aborted: true }, (...args) => console.log("no AbortSignal:", args.length));
await turn();

let thrown;
process.once("uncaughtException", error => console.log("uncaught:", error.message, "phase", thrown.eventPhase));
addAbortListener(signal, event => {
  thrown = event;
  throw new Error("boom");
});
addAbortListener(signal, event => console.log("the next listener:", event.type, event !== thrown));
await turn();
