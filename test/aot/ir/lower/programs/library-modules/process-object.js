// RUN: lower
// OPTIONS: builtin-modules

// The global process and node:process: ticks with arguments, events at the end of the program in their order, exitCode, emitWarning and the warning event, uncaught errors that a listener takes, unhandled rejections, stdout.write with a callback, argv and env as objects, and a few functions that must be there.
import processModule, { nextTick, env } from "node:process";

console.log(processModule === process, env === process.env, nextTick === process.nextTick);
const order = [];
process.nextTick((a, b) => order.push("tick " + a + b), 1, 2);
await null;
console.log(order.join());

process.removeAllListeners("warning");
process.on("warning", warning => console.log("warning:", warning.name, warning.code, warning.message));
process.emitWarning("careful", { code: "MY_CODE", type: "CustomWarning" });
process.emitWarning(Object.assign(new Error("as an error"), { name: "OtherWarning" }));
await new Promise(resolve => setImmediate(resolve));

process.on("uncaughtException", (error, origin) => console.log("uncaught:", error.message, origin));
setTimeout(() => { throw new Error("from a timer"); }, 0);
await new Promise(resolve => setTimeout(resolve, 5));
process.on("unhandledRejection", (reason, promise) => console.log("unhandled:", reason.message, promise instanceof Promise));
Promise.reject(new Error("nobody catches"));
await new Promise(resolve => setTimeout(resolve, 5));

console.log(await new Promise(resolve => process.stdout.write("written directly\n", () => resolve("the callback ran"))));
env.MADE_UP = 1;
console.log(typeof env.MADE_UP, "MADE_UP" in env, delete env.MADE_UP, env.MADE_UP, Array.isArray(process.argv), Array.isArray(process.execArgv), typeof process.execPath, typeof process.argv0);
console.log(process.listenerCount("warning"), process.eventNames().includes("uncaughtException"), typeof process.kill, typeof process.abort, typeof process.chdir, typeof process.emit, typeof process.binding, typeof process.config.variables, typeof process.features.inspector, typeof process.allowedNodeEnvironmentFlags, process.exitCode);
console.log(process.stdout.fd, process.stderr.fd, process.stdin.fd, process.stdout.writable, typeof process.stdout.columns, typeof process.stdout.getWindowSize, process.stdout._type ?? typeof process.stdout._type);
process.on("beforeExit", code => { if (!order.includes("beforeExit")) { order.push("beforeExit"); console.log("beforeExit", code); setTimeout(() => console.log("work started in beforeExit"), 1); } });
process.on("exit", code => console.log("exit", code, process.exitCode));
process.exitCode = 0;
