// One function returns a class and is called three times, so three classes share the code of their methods. A method is replaced on the prototype of the second and another is deleted from the third: the first one, and the other methods, stay as they are. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const ByOne = makeCounter(1);
const ByTen = makeCounter(10);
const ByHundred = makeCounter(100);
const counters: Counter[] = [new ByOne(), new ByTen(), new ByHundred()];

note(twiceAll(counters));
ByTen.prototype.bump = function () {
  this.count -= 1;
  return this.count;
};
note(twiceAll(counters));
for (const counter of counters) note(counter.count);
note(twiceAll([new ByOne(), new ByTen(), new ByHundred()]));
Reflect.deleteProperty(ByHundred.prototype, "twice");
note(attempt(() => twiceAll(counters)));
note(twiceAll([counters[0], counters[1]]));
note(twiceAll([new (makeCounter(1000))()]));
console.log(checksum);

export {};
