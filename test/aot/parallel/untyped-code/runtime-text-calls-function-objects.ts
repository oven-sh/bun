// Functions created from text at run time call and construct compiled functions that need a full function object: a function with a property of its own, a function that is both called and constructed, a class, and static methods read from the class.
type Caller = (callee: unknown, argument?: number) => unknown;
type Describe = (this: unknown, first: unknown) => string;

const callInLoop = new Function("f", "let sum = 0; for (let i = 0; i < 100; i++) sum += f(i); return sum;") as Caller;
const constructInLoop = new Function(
  "F",
  `let sizes = 0, targets = 0, instances = 0;
  for (let i = 0; i < 100; i++) {
    const object = new F(i);
    sizes += object.size;
    if (object.isNewTarget) targets++;
    if (object instanceof F) instances++;
  }
  return sizes + " " + targets + " " + instances;`,
) as Caller;
const callWithReceiver = new Function("f", "return f.call(7) + ' | ' + f.apply(null, [1, 2, 3]);") as Caller;
const callInTry = new Function(
  "f",
  "a",
  `const doubled = a * 2;
  try {
    return "returned " + f(a);
  } catch (error) {
    return "caught " + error.constructor.name + " " + (error instanceof TypeError) + " with " + doubled;
  }`,
) as Caller;

const triple: ((value: number) => number) & { calls?: number } = function (value) {
  triple.calls!++;
  return value * 3;
};
triple.calls = 0;
const describeCall: Describe & { label?: string } = function (first) {
  return `${describeCall.label}: this ${String(this)}, first ${String(first)}, ${arguments.length} arguments`;
};
describeCall.label = "function";

function Size(this: any, size: number): any {
  if (size < 0) throw new RangeError("negative size " + size);
  if (!new.target) return size + 1;
  this.size = size;
  this.isNewTarget = new.target === Size;
}

class Box {
  size: number;
  isNewTarget: boolean;
  constructor(size: number) {
    this.size = size * 2;
    this.isNewTarget = new.target === Box;
  }
  static half(value: number): number {
    return value / 2;
  }
  static describeCall(this: unknown, first: unknown): string {
    return `static method: this ${String(this)}, first ${String(first)}, ${arguments.length} arguments`;
  }
}
const half = Box.half;

const show = (label: string, ...results: unknown[]) => console.log(label + ": " + results.join(" | "));
show("compiled callers", triple(1), Size(1), new (Size as any)(2).size, new Box(2).size, half(2));
show("call", callInLoop(triple), callInLoop(Size), callInLoop(half), callInLoop(triple), triple.calls);
show("construct", constructInLoop(Size), constructInLoop(Box), constructInLoop(Size));
show("receiver and arguments", callWithReceiver(describeCall), callWithReceiver(Box.describeCall));
show("throw", callInTry(Size, 20), callInTry(Size, -20), callInTry(Size, 21));
show("class without new", callInTry(Box, 22), callInTry(half, 22), callInTry(Box, 23), callInTry(triple, 23));

export {};
