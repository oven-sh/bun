// One function returns a class and is called three times, so three classes share the code of their methods. A method is replaced on the prototype of the second and another is deleted from the third: the first one, and the other methods, stay as they are.
function makeCounter(step: number) {
  return class Counter {
    count = 0;
    bump(): number {
      this.count += step;
      return this.count;
    }
    twice(): number {
      return this.bump() + this.bump();
    }
  };
}
type Counter = InstanceType<ReturnType<typeof makeCounter>>;

function twiceAll(counters: Counter[]): number {
  let sum = 0;
  for (const counter of counters) sum += counter.twice();
  return sum;
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const ByOne = makeCounter(1);
const ByTen = makeCounter(10);
const ByHundred = makeCounter(100);
const counters: Counter[] = [new ByOne(), new ByTen(), new ByHundred()];

note("at first", twiceAll(counters));
ByTen.prototype.bump = function () {
  this.count -= 1;
  return this.count;
};
note("the second class has another bump", twiceAll(counters));
for (const counter of counters) note("counts", counter.count);
note("new objects", twiceAll([new ByOne(), new ByTen(), new ByHundred()]));
Reflect.deleteProperty(ByHundred.prototype, "twice");
note("the third class has lost twice", attempt(() => twiceAll(counters)));
note("the first two", twiceAll([counters[0], counters[1]]));
note("a fourth class", twiceAll([new (makeCounter(1000))()]));

export {};
