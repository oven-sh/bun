// Exports of start-up modules: the process is an emitter that native code made; listeners, rawListeners and emit hand the program's functions back or call them with what the program passes as `any`.
let total = 0;

function onExit(code: number): void {
  total += typeof code === "number" ? 1 : typeof code === "string" ? 100 : 10000;
}
function onBeforeExit(code: number): void {
  total += typeof code === "number" ? 100000 : typeof code === "string" ? 1000000 : 10000000;
}
function onCustom(value: number): void {
  total += typeof value === "number" ? 100000000 : 200000000;
}

onExit(0);
onBeforeExit(0);
onCustom(0);
process.on("exit", onExit);
process.once("beforeExit", onBeforeExit);
process.on("custom" as any, onCustom);
for (const listener of process.listeners("exit") as any[]) listener("text");
for (const listener of process.rawListeners("beforeExit") as any[]) listener("text");
process.emit("custom" as any, "text" as any);
process.on("exit", () => console.log(total, process.listenerCount("exit"), process.eventNames().length));
