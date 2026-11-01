// A factory makes a constructor function whose prototype object is a literal put together from what the call hands in, and returns a function that constructs. A loop runs whatever method each object finds there.
// Each call of the factory in the module's body has a copy of the constructor with a layout of its own. So the store in the constructor goes to a slot, and what a step holds has the type that this kind of step is given:
// the functions among them are called without a look at what they are. With one layout for all six kinds, each object arrives with another prototype object than the layout says: 28 accesses by name a turn. Now 16.
// COUNT: arrivals <= 33000
const args = "~w/args";
const evaluate = "~w/evaluate";
const contA = "~w/contA";
const BaseProto = {
  pipe(this: any) {
    return this;
  },
  toJSON(this: any) {
    return { op: this.op };
  },
};
function defaultEvaluate(this: any, _fiber: Fiber): any {
  return undefined;
}
const makeProto = (options: any): any =>
  ({
    ...BaseProto,
    op: options.op,
    [evaluate]: options[evaluate] ?? defaultEvaluate,
    [contA]: options[contA],
  }) as any;
const makePrimitive = <Fn extends (...a: Array<any>) => any>(options: any): Fn => {
  const Proto = makeProto(options);
  const Impl = function (this: any, value: any) {
    this[args] = value;
  } as any;
  Impl.prototype = Proto;
  return function (value: any) {
    return new Impl(value);
  } as Fn;
};
class Fiber {
  stack: Array<any> = [];
  result: any = undefined;
  done = false;
  getCont(): any {
    return this.stack.pop();
  }
  finish(value: any): any {
    this.result = value;
    this.done = true;
    return undefined;
  }
  run(effect: any): any {
    let current = effect;
    this.done = false;
    while (!this.done) current = current[evaluate](this);
    return this.result;
  }
}
const succeed = makePrimitive<(value: any) => any>({
  op: "Succeed",
  [evaluate](this: any, fiber: Fiber) {
    const cont = fiber.getCont();
    return cont ? cont[contA](this[args], fiber) : fiber.finish(this[args]);
  },
});
const sync = makePrimitive<(thunk: () => any) => any>({
  op: "Sync",
  [evaluate](this: any, fiber: Fiber) {
    const value = this[args]();
    const cont = fiber.getCont();
    return cont ? cont[contA](value, fiber) : fiber.finish(value);
  },
});
const suspend = makePrimitive<(thunk: () => any) => any>({
  op: "Suspend",
  [evaluate](this: any, _fiber: Fiber) {
    return this[args]();
  },
});
const withFiber = makePrimitive<(f: (fiber: Fiber) => any) => any>({
  op: "WithFiber",
  [evaluate](this: any, fiber: Fiber) {
    return this[args](fiber);
  },
});
const map = makePrimitive<(pair: [any, (value: any) => any]) => any>({
  op: "Map",
  [evaluate](this: any, fiber: Fiber) {
    fiber.stack.push(this);
    return this[args][0];
  },
  [contA](this: any, value: any, _fiber: Fiber) {
    return succeed(this[args][1](value));
  },
});
const flatMap = makePrimitive<(pair: [any, (value: any) => any]) => any>({
  op: "FlatMap",
  [evaluate](this: any, fiber: Fiber) {
    fiber.stack.push(this);
    return this[args][0];
  },
  [contA](this: any, value: any, _fiber: Fiber) {
    return this[args][1](value);
  },
});
const turns = 2000;
const fiber = new Fiber();
let total = 0;
for (let i = 0; i < turns; i++) {
  const program = flatMap([
    map([sync(() => i & 7), (n: number) => n + 1]),
    (n: number) => suspend(() => withFiber(f => succeed(n + f.stack.length))),
  ]);
  total += fiber.run(program);
}
console.log(total);
