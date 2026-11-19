// The constructor comes off the global object under a name that the program makes, and the worker runs the program's own entry point.
const global = globalThis as any;
const name = Object.getOwnPropertyNames(global).find(key => key.startsWith("Work") && key.length === 6)!;

if (Bun.isMainThread) {
  console.log("main thread:", import.meta.main);
  const starts: [string, () => any][] = [
    ["by key", () => new global[["Wor", "ker"].join("")](Bun.main)],
    ["by key, in place", () => new (globalThis as any)[["Wor", "ker"].join("")](Bun.main)],
    ["Reflect", () => Reflect.construct(Reflect.get(globalThis, name), [Bun.main])],
  ];
  for (const [how, start] of starts) {
    const worker = start();
    console.log(how, await new Promise(resolve => (worker.onmessage = (event: MessageEvent) => resolve(event.data))));
    worker.terminate();
  }
} else {
  postMessage(import.meta.main ? "main" : "not main");
}
