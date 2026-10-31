// Each thread has its own global object, classes, module variables and registry of symbols. What one thread adds to a class, a global or a module variable, another does not see.
let moduleVariable = 0;
const registry = new Map<string, number>();
class Counted {
  static instances = 0;
  constructor() {
    Counted.instances++;
  }
}
const attempt = (run: () => unknown): string => {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).name;
  }
};
function facts(who: string): string {
  return [who, moduleVariable, registry.size, Counted.instances, typeof (globalThis as any).addedGlobal, typeof (Array.prototype as any).addedToArray, typeof (Counted.prototype as any).addedMethod, typeof (Counted as any).addedStatic,
    Symbol.for("shared").description, Symbol.keyFor(Symbol.for("shared")), [1, 2].map(n => n * 2).join(), typeof (Math as any).added, (globalThis as any).name ?? "no name"].join(" ");
}
function change(): string {
  moduleVariable += 5;
  registry.set("k" + registry.size, 1);
  new Counted();
  (globalThis as any).addedGlobal = 1;
  return [attempt(() => ((Array.prototype as any).addedToArray = () => 1)), attempt(() => ((Counted.prototype as any).addedMethod = () => 1)), attempt(() => ((Counted as any).addedStatic = 1)), attempt(() => ((Math as any).added = 1))].join();
}

if (Bun.isMainThread) {
  console.log(facts("main before"));
  const ask = (worker: Worker, what: string) => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.postMessage(what);
  });
  const first = new Worker(new URL(import.meta.url));
  console.log(await ask(first, "facts"));
  console.log("the first changes:", await ask(first, "change"));
  console.log(await ask(first, "facts"));
  console.log(facts("main behind the first's changes"));
  console.log("main changes:", change());
  console.log(facts("main behind its own"));
  const second = new Worker(new URL(import.meta.url));
  console.log(await ask(second, "facts"));
  console.log(await ask(first, "facts"));
  const symbol = await ask(first, "symbol");
  console.log("a registered symbol cannot be posted:", symbol);
  first.terminate();
  second.terminate();
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    if (event.data === "facts") postMessage(facts("worker"));
    else if (event.data === "change") postMessage(change());
    else postMessage(attempt(() => postMessage(Symbol.for("shared"))));
  });
}
