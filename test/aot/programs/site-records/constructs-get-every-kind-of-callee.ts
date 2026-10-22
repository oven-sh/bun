// `new` of a value that is declared a class gets classes, subclasses, functions, bound functions, proxies, constructors that return something else, and values that cannot be constructed.
interface Made {
  kind?: string;
  argument?: number;
}
type Maker = new (argument: number) => Made;

function attempt(run: () => unknown): string {
  try {
    const value = run() as any;
    return JSON.stringify(value) + " " + (Object.getPrototypeOf(value)?.constructor?.name ?? "none");
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function make(maker: Maker): Made {
  return new maker(1);
}
function makeWithoutArguments(maker: Maker): Made {
  return new (maker as any)();
}
function makeMember(holder: { Maker: Maker }): Made {
  return new holder.Maker(2);
}
function look(mark: string, value: unknown): void {
  const maker = value as Maker;
  console.log(mark + ":", attempt(() => make(maker)), "|", attempt(() => make(maker)), "|", attempt(() => makeWithoutArguments(maker)), "|", attempt(() => makeMember({ Maker: maker })));
}

class Expected {
  kind = "expected";
  constructor(public argument: number) {}
}
class Heir extends Expected {
  more = true;
}
class Other {
  argument = -1;
  kind = "other";
}
class ReturnsObject {
  kind = "dropped";
  constructor() {
    return { kind: "returned instead" };
  }
}
class ReturnsNumber {
  kind = "kept";
  constructor() {
    return 5 as any;
  }
}
class HeirReturnsNumber extends Expected {
  constructor() {
    super(0);
    return 5 as any;
  }
}
class HeirWithoutSuper extends Expected {
  constructor() {
    if (Math.abs(1) === 2) super(0);
  }
}
class SeesNewTarget {
  kind: string;
  constructor() {
    this.kind = "made for " + new.target.name;
  }
}
class HeirSeesNewTarget extends SeesNewTarget {}
function Ordinary(this: Made, argument: number) {
  this.kind = "ordinary function";
  this.argument = argument;
}
function OrdinaryReturns() {
  return [1];
}

look("expected", Expected);
look("heir", Heir);
look("expected", Expected);
look("other", Other);
look("returns an object", ReturnsObject);
look("returns a number", ReturnsNumber);
look("an heir returns a number", HeirReturnsNumber);
look("an heir without super", HeirWithoutSuper);
look("sees new.target", SeesNewTarget);
look("an heir sees new.target", HeirSeesNewTarget);
look("a bound class sees new.target", SeesNewTarget.bind(null));
look("a proxy is new.target", new Proxy(SeesNewTarget, {}));
look("function", Ordinary);
look("function that returns", OrdinaryReturns);
look("bound class", Expected.bind(null, 9));
look("bound function", Ordinary.bind({ kind: "ignored" }));
look("proxy", new Proxy(Expected, {}));
look("proxy with a trap", new Proxy(Expected, { construct: (_target, list) => ({ kind: "trapped", argument: list.length }) }));
look("proxy whose trap returns a number", new Proxy(Expected, { construct: () => 5 as any }));
look("native", Array);
look("native", Object);
look("expected", Expected);
look("arrow", () => ({}));
look("method", { method() {} }.method);
look("async function", async function () {});
look("generator", function* () {});
look("native function", Math.max);
look("symbol constructor", Symbol);
look("undefined", undefined);
look("null", null);
look("object", {});
look("text", "Expected");
look("expected", Expected);

export {};
