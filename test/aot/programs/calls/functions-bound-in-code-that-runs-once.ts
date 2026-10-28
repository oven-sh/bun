// Functions are bound at module level and in the constructor of an object that is made once, and the results are called often.
// The functions pass through a table that is read by computed names first, so nothing proves that they still inherit the built-in `bind`, or still have their names and lengths.
const lines: string[] = [];
const hidden: string = process.env.NO_SUCH_VARIABLE ?? "";
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const changes: any = {
  nothing(_target: any) {},
  ownBind(target: any) {
    target["bind" + hidden] = function (this: any) {
      return (n: number) => "own bind " + this.name + " " + n;
    };
  },
  inheritedBind(target: any) {
    Object.setPrototypeOf(target, {
      bind(this: any) {
        return (n: number) => "inherited bind " + typeof this + " " + n;
      },
    });
  },
  otherPrototype(target: any) {
    Object.setPrototypeOf(target, Object.create(Function.prototype, { marker: { value: "marked" } }));
  },
  otherName(target: any) {
    Object.defineProperty(target, "name" + hidden, { value: "renamed" });
  },
  otherLength(target: any) {
    Object.defineProperty(target, "length" + hidden, { value: 7 });
  },
  noName(target: any) {
    delete target["name" + hidden];
  },
};
function change(name: string, target: any): void {
  changes[name + hidden](target);
}
function callOften(bound: any): unknown {
  let sum: any = 0;
  for (let i = 0; i < 3000; i++) sum = bound(i & 3);
  return sum;
}
function describe(label: string, bound: any): void {
  lines.push(
    label + ": " + attempt(() => bound(1)) + " | " + attempt(() => callOften(bound)) + " | " + attempt(() => bound.name) + " | " + attempt(() => bound.length) + " | " + attempt(() => bound.marker) + " | " + attempt(() => "prototype" in bound),
  );
}

function untouched(this: any, n: number): string {
  return "untouched " + this + " " + n;
}
change("nothing", untouched);
describe("untouched", untouched.bind(null));

function withOwnBind(this: any, n: number): string {
  return "never " + this + " " + n;
}
change("ownBind", withOwnBind);
describe("a bind of its own", withOwnBind.bind(null));

function withInheritedBind(this: any, n: number): string {
  return "never " + this + " " + n;
}
change("inheritedBind", withInheritedBind);
describe("a bind from another prototype", withInheritedBind.bind(null));

function withOtherPrototype(this: any, n: number): string {
  return "other prototype " + this + " " + n;
}
change("otherPrototype", withOtherPrototype);
describe("another prototype that inherits bind", withOtherPrototype.bind(undefined));

function withOtherName(this: any, n: number): string {
  return "other name " + this + " " + n;
}
change("otherName", withOtherName);
describe("another name", withOtherName.bind("text"));

function withOtherLength(this: any, n: number): string {
  return "other length " + this + " " + n;
}
change("otherLength", withOtherLength);
describe("another length", withOtherLength.bind(5));

function withoutName(this: any, n: number): string {
  return "no name " + this + " " + n;
}
change("noName", withoutName);
describe("no name", withoutName.bind(true));

function withArguments(this: any, a: number, b: number, c: number): string {
  return "arguments " + this + " " + a + " " + b + " " + c + " " + arguments.length;
}
change("nothing", withArguments);
describe("one bound argument", withArguments.bind(null, 10));
describe("as many bound arguments as parameters", withArguments.bind(null, 10, 20, 30));
describe("more bound arguments than parameters", (withArguments as any).bind(null, 10, 20, 30, 40, 50));
describe("no argument at all", (withArguments as any).bind());

const expression: any = {
  kept: function named(this: any, n: number): string {
    return "expression " + this + " " + n;
  }.bind(null),
  arrow: ((n: number): string => "arrow " + n).bind(null),
};
describe("a function expression", expression["kept" + hidden]);
describe("an arrow function", expression["arrow" + hidden]);

function Made(this: any, n: number): void {
  this.n = n;
}
Made.prototype.read = function (this: any): string {
  return "made " + this.n;
};
change("nothing", Made);
const BoundMade: any = Made.bind({ ignored: true });
lines.push("constructed: " + attempt(() => new BoundMade(4).read()) + " | " + attempt(() => new BoundMade(4) instanceof BoundMade) + " | " + attempt(() => new BoundMade(4) instanceof (Made as any)));

class Shape {
  constructor(public sides: number) {}
}
change("nothing", Shape);
const BoundShape: any = Shape.bind(null, 3);
lines.push("a class: " + attempt(() => BoundShape()) + " | " + attempt(() => new BoundShape().sides) + " | " + BoundShape.name);

async function later(this: any, n: number): Promise<string> {
  return "later " + this + " " + n;
}
change("nothing", later);
const boundLater = later.bind(null);
function* counted(this: any, n: number): Generator<string> {
  yield "counted " + this + " " + n;
}
change("nothing", counted);
const boundCounted = counted.bind(null);
lines.push("a generator: " + attempt(() => boundCounted(2).next().value) + " | " + boundCounted.name);

class Listener {
  heard = 0;
  constructor() {
    this.hear = this.hear.bind(this);
  }
  hear(n: number): number {
    return (this.heard += n);
  }
}
const holders: any = { only: new Listener() };
const hear = holders["only" + hidden].hear;
describe("a method bound in the constructor of one object", hear);
lines.push("heard: " + holders.only.heard);

const twice = untouched.bind(1).bind(2);
describe("bound twice", twice);

lines.push("an async function: " + (await boundLater(3)) + " | " + boundLater.name);
console.log(lines.join("\n"));
