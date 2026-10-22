// Built ins found by binding: programs listeners. It prints what plain Bun prints.
import { on as importedOn, listenerCount as importedCount } from "node:process";

const seen: string[] = [];
const first = (value: unknown) => seen.push("first " + value);
const second = (value: unknown) => seen.push("second " + value);

console.log(Object.hasOwn(process, "on"), typeof process.on, process.on.name, process.on.length);
console.log(process.on === Object.getPrototypeOf(process).on, importedOn === process.on, importedCount === process.listenerCount);
console.log(process.on("custom", first) === process, process.once("custom", second) === process);
console.log(process.listenerCount("custom"), process.listeners("custom").length, process.rawListeners("custom").length);
console.log(process.eventNames().includes("custom"), typeof process.getMaxListeners());
console.log(process.emit("custom", 1), process.emit("custom", 2), process.emit("nobody"));
console.log(seen.join(", "));
process.prependListener("custom", second);
process.prependOnceListener("custom", value => seen.push("third " + value));
process.emit("custom", 3);
console.log(seen.join(", "));
console.log(process.off("custom", first) === process, process.removeListener("custom", second) === process, process.listenerCount("custom"));
process.addListener("other", first);
console.log(process.removeAllListeners("other") === process, process.listenerCount("other"));
console.log(process.setMaxListeners(20), process.getMaxListeners());
console.log(process.constructor.name, Object.prototype.toString.call(Object.getPrototypeOf(process)), Object.prototype.toString.call(process));
console.log((process as any).domain, (process as any).noDeprecation, (process as any).traceDeprecation, (process as any).traceProcessWarnings, (process as any)._exiting);

const other: any = {};
console.log((process.on as any).call(other, "x", first) === other, Object.keys(other).join(), (process.listenerCount as any).call(other, "x"));
try {
  (process.on as any).call(undefined, "x", first);
} catch (error) {
  console.log((error as Error).constructor.name);
}
try {
  (process.on as any)("x");
} catch (error) {
  console.log((error as Error).constructor.name, (error as Error).message);
}

const emit = process.emit;
(process as any).emit = function (this: unknown, name: string, ...rest: unknown[]) {
  if (name === "exit" || name === "beforeExit") console.log("emit is replaced: " + name + " " + rest.length);
  return (emit as any).call(this, name, ...rest);
};
console.log(Object.hasOwn(process, "emit"), process.emit !== emit);
process.on("beforeExit", code => console.log("before exit " + code));
process.once("exit", code => console.log("exit " + code));
(process as any).on = 5;
console.log((process as any).on + 1, Object.hasOwn(process, "on"));
delete (process as any).on;
console.log(typeof process.on);
