async function attempt(name: string, run: () => unknown): Promise<void> {
  try {
    console.log(name + ":", await run());
  } catch (error) {
    console.log(name + ": throws", (error as Error).name);
  }
}

class Read { n = 1; m(): number { return this.n; } get g(): number { return this.n; } }
await attempt("read in every way that runs no code", () =>
  [
    Object.keys(Read.prototype).join(),
    Object.getOwnPropertyNames(Read.prototype).join(),
    Object.getOwnPropertySymbols(Read.prototype).length,
    typeof Object.getOwnPropertyDescriptor(Read.prototype, "m")!.value,
    Object.keys(Object.getOwnPropertyDescriptors(Read.prototype)).join(),
    Object.hasOwn(Read.prototype, "m"),
    Reflect.ownKeys(Read.prototype).join(),
    Reflect.has(Read.prototype, "g"),
    typeof Reflect.getOwnPropertyDescriptor(Read.prototype, "g")!.get,
    new Read().m(),
  ].join(" "));

class Source { jump(): string { return "jump"; } }
class Target { x = 1; }
interface Target extends Source {}
await attempt("read from one class, added to another", () => {
  for (const name of Object.getOwnPropertyNames(Source.prototype)) {
    if (name !== "constructor") Object.defineProperty(Target.prototype, name, Object.getOwnPropertyDescriptor(Source.prototype, name)!);
  }
  return [new Target().jump(), new Source().jump()].join(" ");
});

class Both { n = 1; }
await attempt("read and also added to", () => {
  const before = Object.keys(Both.prototype).join();
  (Both.prototype as any).extra = 7;
  return [before, Object.keys(Both.prototype).join(), (new Both() as any).extra].join(" ");
});

class Visited { n = 1; }
Object.defineProperty(Visited.prototype, "late", { enumerable: true, configurable: true, get(this: any) { this.added = 7; return 1; } });
await attempt("a getter that adds to its receiver, called by Object.values", () => [Object.values(Visited.prototype).join(), (new Visited() as any).added].join(" "));
