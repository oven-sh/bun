function told(ask: () => unknown): unknown {
  try {
    return ask();
  } catch (error) {
  }
}
class C1 extends RegExp {
  extra = 5;
  constructor() {
    super("a");
  }
  tag(): string {
    return "C1";
  }
}
function ask1(x: C1): string {
  return [told(() => x instanceof RegExp), told(() => "extra" in x), told(() => x.extra + 1), told(() => x.source), told(() => typeof x.tag), told(() => ((x.extra = 9), x.extra))].join();
}
console.log("scene 1", told(() => ask1(JSON.parse("[0]").map(() => (new Proxy(new C1(), {})))[0])));