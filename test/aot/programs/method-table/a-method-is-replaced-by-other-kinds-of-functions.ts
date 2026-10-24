// A method that takes one argument is replaced by functions of other kinds: without parameters, with more parameters, with a rest parameter, an arrow, a bound function, built-ins, a method of another class and a proxy of a function.
class Gauge {
  constructor(public level: number) {}
  scaled(factor: number): number {
    return this.level * factor;
  }
}
class Half extends Gauge {
  scaled(factor: number): number {
    return (this.level * factor) / 2;
  }
}
class Same extends Gauge {}

class Stranger {
  level = 900;
  scaled(factor: number): number {
    return this.level - factor;
  }
}

function read(gauges: Gauge[]): number {
  let sum = 0;
  for (const gauge of gauges) sum = sum * 100 + gauge.scaled(3);
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

const gauges: Gauge[] = [new Gauge(2), new Half(4), new Same(5)];
const original = Gauge.prototype.scaled;

note("at first", read(gauges));
Gauge.prototype.scaled = function () {
  return arguments.length + this.level;
};
note("no parameters", read(gauges));
Gauge.prototype.scaled = function (factor: number, more?: number, evenMore = 7) {
  return more === undefined ? factor + evenMore : -1;
};
note("more parameters", read(gauges));
Gauge.prototype.scaled = function (...all: number[]) {
  return all.length * 10 + all[0];
};
note("a rest parameter", read(gauges));
Gauge.prototype.scaled = factor => factor + 1;
note("an arrow", read(gauges));
Gauge.prototype.scaled = original.bind(new Gauge(20));
note("a bound function", read(gauges));
Gauge.prototype.scaled = Math.sqrt;
note("Math.sqrt", Math.round(read(gauges)));
Gauge.prototype.scaled = Math.max;
note("Math.max", read(gauges));
Gauge.prototype.scaled = Number.prototype.valueOf;
note("Number.prototype.valueOf", attempt(() => read(gauges)));
Gauge.prototype.scaled = Stranger.prototype.scaled;
note("a method of another class", read(gauges));
Gauge.prototype.scaled = new Proxy(original, {});
note("a proxy of the method", read(gauges));
Half.prototype.scaled = Math.abs;
note("the override is Math.abs", read(gauges));
Gauge.prototype.scaled = original;
note("the base method is back", read(gauges));

export {};
