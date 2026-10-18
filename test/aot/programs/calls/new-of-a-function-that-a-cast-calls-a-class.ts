interface Box {
  readonly tag: string;
  readonly value: unknown;
}
type BoxClass = new (value: unknown) => Box;
const held = "~held";
function makeMaker(tag: string): (value: unknown) => Box {
  const Proto = {
    tag,
    get value(): unknown {
      return (this as any)[held];
    },
  };
  const Made = function (this: any, value: unknown) {
    this[held] = value;
  } as unknown as BoxClass;
  Made.prototype = Proto;
  return (value: unknown) => new Made(value);
}
function makeChanging(): { make: (value: unknown) => Box; change: () => void } {
  let Made = function (this: any, value: unknown) {
    this[held] = value;
    this.tag = "first";
  } as unknown as BoxClass;
  return {
    make: (value: unknown) => new Made(value),
    change: () => {
      Made = function (this: any, value: unknown) {
        this[held] = [value];
        this.tag = "second";
      } as unknown as BoxClass;
    },
  };
}
function makeReturning(): (value: unknown) => Box {
  const Made = function (this: any, value: unknown) {
    this[held] = value;
    if (typeof value === "string") return { tag: "returned", value };
  } as unknown as BoxClass;
  Made.prototype = { tag: "made" };
  return (value: unknown) => new Made(value);
}
function makeThrowing(): (value: unknown) => Box {
  const Made = function (this: any, value: unknown) {
    if (value === 3) throw new RangeError("three");
    this.tag = "fine";
  } as unknown as BoxClass;
  return (value: unknown) => new Made(value);
}
function makeFromArrow(): (value: unknown) => Box {
  const Made = ((value: unknown) => ({ tag: "arrow", value })) as unknown as BoxClass;
  return (value: unknown) => new Made(value);
}
function makeWithTarget(): (value: unknown) => Box {
  const Made = function (this: any, value: unknown) {
    this.tag = new.target === undefined ? "no target" : typeof new.target;
    this[held] = value;
  } as unknown as BoxClass;
  return (value: unknown) => new Made(value);
}
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
const describe = (box: Box) => box.tag + " " + JSON.stringify(box.value) + " " + JSON.stringify(box) + " " + Object.keys(box).join();
const succeed = makeMaker("Success");
const fail = makeMaker("Failure");
let all = "";
for (let i = 0; i < 6; i++) all += describe(i % 2 ? succeed(i) : fail("f" + i)) + ";";
show("two makers of one function", () => all);
show("prototypes", () => Object.getPrototypeOf(succeed(1)) === Object.getPrototypeOf(succeed(2)) && Object.getPrototypeOf(succeed(1)) !== Object.getPrototypeOf(fail(1)));
const changing = makeChanging();
show("before the change", () => describe(changing.make(1)));
changing.change();
show("after the change", () => describe(changing.make(2)));
const returning = makeReturning();
for (const value of [1, "text", null]) show("returns an object or not", () => describe(returning(value)));
const throwing = makeThrowing();
for (const value of [2, 3, 4]) show("throws", () => describe(throwing(value)));
show("an arrow function", () => describe(makeFromArrow()(1)));
show("new.target", () => describe(makeWithTarget()(1)));
