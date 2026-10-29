// Error.prepareStackTrace makes `stack` where a program has set it, Error.captureStackTrace puts one on any object, and Error.stackTraceLimit cuts it.
const say = (...values) => console.log(...values);
class Seen { constructor(error, sites) { this.message = error.message; this.isList = Array.isArray(sites); } describe() { return `made for ${this.message}, ${this.isList}`; } }

say(typeof new Error("before").stack, Error.prepareStackTrace);
Error.prepareStackTrace = (error, sites) => new Seen(error, sites);
const made = new Error("during");
say(made.stack.describe(), made.stack === made.stack, made.stack instanceof Seen);
class Mine extends Error {}
say(new Mine("a subclass").stack.describe(), new TypeError("a kind").stack.describe());
Error.prepareStackTrace = function (error) { return this === Error ? error.message.length : -1; };
say(new Error("four").stack + 1);
Error.prepareStackTrace = undefined;
say(typeof new Error("after").stack, new Error("after").stack.split("\n")[0]);

const holder = { name: "Holder", message: "held" };
Error.captureStackTrace(holder);
say(typeof holder.stack, holder.stack.split("\n")[0], Object.getOwnPropertyNames(holder).includes("stack"));
function outer() { const target = {}; Error.captureStackTrace(target, outer); return target.stack; }
say(outer().includes("outer"));
const again = new Error("again");
Error.captureStackTrace(again);
say(again.stack.split("\n")[0], again.message.length);

const limit = Error.stackTraceLimit;
Error.stackTraceLimit = 0;
say(new Error("no frames").stack);
Error.stackTraceLimit = limit;
say(new Error("frames again").stack.split("\n").length > 1);
