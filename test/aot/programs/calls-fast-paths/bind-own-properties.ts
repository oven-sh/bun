// `f.bind(..)` looks up `bind`, reads `name` and `length` of its target and inherits its prototype: closures with own properties, classes and more than three bound arguments get what plain Bun gives them.
const log: string[] = [];

function describe(label: string, bound: Function): void {
  log.push(`${label}: ${JSON.stringify(bound.name)} ${bound.length} [${Object.getOwnPropertyNames(bound).sort().join()}]`);
}

function comparePrototypes(label: string, target: Function, bound: Function): void {
  log.push(`${label}: ${Object.getPrototypeOf(bound) === Object.getPrototypeOf(target)} ${Object.hasOwn(bound, "prototype")}`);
}

function sum(a: number, b: number, c: number, d: number, e: number): number {
  return a + b * 10 + c * 100 + d * 1000 + e * 10000;
}

function receiver(this: unknown): unknown {
  return this;
}

class Widget {
  constructor(
    public a: number,
    public b: number,
  ) {}
}

class Gadget extends Widget {
  constructor(a: number) {
    super(a, -a);
  }
}

function boundArguments(): void {
  const none = sum.bind(null);
  const one = sum.bind(null, 1);
  const two = sum.bind(null, 1, 2);
  const three = sum.bind(null, 1, 2, 3);
  const four = sum.bind(null, 1, 2, 3, 4);
  const five = sum.bind(null, 1, 2, 3, 4, 5);
  describe("no bound argument", none);
  describe("one bound argument", one);
  describe("two bound arguments", two);
  describe("three bound arguments", three);
  describe("four bound arguments", four);
  describe("five bound arguments", five);
  log.push([none(1, 2, 3, 4, 5), one(2, 3, 4, 5), two(3, 4, 5), three(4, 5), four(5), five()].join());
}

function boundThis(): void {
  const object = { label: "object" };
  log.push([receiver.bind(undefined)(), receiver.bind(null)(), receiver.bind(5)(), receiver.bind("text")()].map(String).join());
  log.push(`${receiver.bind(object)() === object} ${receiver.bind(object).bind(null)() === object}`);
  describe("bound twice", receiver.bind(object).bind(null));
}

function ownName(): void {
  function target(a: number, b: number): number {
    return a + b;
  }
  describe("original name", target.bind(null));
  const early = target.bind(null, 1);
  Object.defineProperty(target, "name", { value: "renamed" });
  describe("own name", target.bind(null));
  describe("bound before the name changed", early);
  Object.defineProperty(target, "name", { value: 5 });
  describe("own name that is a number", target.bind(null));
  Object.defineProperty(target, "name", {
    get() {
      log.push("name is read");
      return "computed";
    },
  });
  describe("own name that is a getter", target.bind(null));
  delete (target as any).name;
  describe("deleted name", target.bind(null));
  log.push(`${early(2)} ${target.bind(null, 3)(4)}`);
}

function ownLength(): void {
  function target(a: number, b: number, c: number): number {
    return a + b + c;
  }
  describe("original length", target.bind(null, 1));
  const early = target.bind(null, 1);
  for (const length of [7, 1.5, -2, Infinity, "3"]) {
    Object.defineProperty(target, "length", { value: length });
    describe(`own length ${JSON.stringify(String(length))}`, target.bind(null, 1));
  }
  describe("bound before the length changed", early);
  Object.defineProperty(target, "length", {
    get() {
      log.push("length is read");
      return 4;
    },
  });
  describe("own length that is a getter", target.bind(null, 1));
  delete (target as any).length;
  describe("deleted length", target.bind(null, 1));
  log.push(`${early(2, 3)} ${target.bind(null, 4)(5, 6)}`);
}

function ownBind(): void {
  function target(): string {
    return "target";
  }
  log.push(target.bind(null)());
  (target as any).bind = function (this: unknown, thisValue: unknown): () => string {
    log.push(`own bind runs: ${this === target} ${thisValue}`);
    return () => "own bind";
  };
  log.push(target.bind(null)());
  delete (target as any).bind;
  log.push(target.bind(null)());

  const inheriting = function (): string {
    return "inheriting";
  };
  Object.setPrototypeOf(inheriting, {
    bind(): () => string {
      return () => "inherited bind";
    },
  });
  log.push(inheriting.bind(null)());
}

function otherOwnProperties(): void {
  function target(a: number): number {
    return a + 1;
  }
  (target as any).extra = "extra";
  describe("own property of another name", target.bind(null));
  log.push(`${target.bind(null, 1)()} ${Object.hasOwn(target.bind(null), "extra")}`);
  target.prototype = { replaced: true };
  const bound = target.bind(null);
  describe("own prototype property", bound);
  log.push(`${Object.getPrototypeOf(new (bound as any)(1)) === target.prototype}`);
}

function prototypes(): void {
  async function asynchronous(): Promise<number> {
    return 1;
  }
  function* generator(): Generator<number> {
    yield 1;
  }
  async function* asynchronousGenerator(): AsyncGenerator<number> {
    yield 1;
  }
  const arrow = (): number => 1;
  function moved(): number {
    return 1;
  }
  Object.setPrototypeOf(moved, Object.create(Function.prototype));
  comparePrototypes("function", sum, sum.bind(null));
  comparePrototypes("async function", asynchronous, asynchronous.bind(null));
  comparePrototypes("generator function", generator, generator.bind(null));
  comparePrototypes("async generator function", asynchronousGenerator, asynchronousGenerator.bind(null));
  comparePrototypes("arrow function", arrow, arrow.bind(null));
  comparePrototypes("function with another prototype", moved, moved.bind(null));
  describe("async function", asynchronous.bind(null));
  describe("arrow function", arrow.bind(null));
}

function classes(): void {
  const BoundWidget = Widget.bind(null, 1);
  describe("class", BoundWidget);
  comparePrototypes("class", Widget, BoundWidget);
  const widget = new BoundWidget(2);
  log.push(`${widget instanceof Widget} ${widget instanceof BoundWidget} ${widget.a} ${widget.b}`);
  try {
    (BoundWidget as any)(2);
    log.push("no error");
  } catch (error) {
    log.push(`called without new: ${(error as Error).constructor.name}`);
  }
  const BoundGadget = Gadget.bind(null);
  describe("derived class", BoundGadget);
  comparePrototypes("derived class", Gadget, BoundGadget);
  log.push(`${Object.getPrototypeOf(BoundGadget) === Widget} ${new BoundGadget(3).b} ${Reflect.construct(BoundWidget, [4], Gadget) instanceof Gadget}`);
}

function makeAdder(base: number): (first: number, second: number) => number {
  return function adder(first: number, second: number): number {
    return base + first + second;
  };
}

function hotLoop(): void {
  let total = 0;
  for (let i = 0; i < 200000; i++) {
    const adder = makeAdder(i & 7);
    if ((i & 4095) === 4095) Object.defineProperty(adder, "name", { value: "renamed" });
    const bound = adder.bind(null, 1);
    total += bound(2) + bound.name.length + bound.length;
  }
  log.push(`total ${total}`);
}

boundArguments();
boundThis();
ownName();
ownLength();
ownBind();
otherOwnProperties();
prototypes();
classes();
hotLoop();
console.log(log.join("\n"));

export {};
