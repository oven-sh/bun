// o.m.call(other), o.m.apply(other) and Reflect.apply: the method comes from one object and runs on another: an instance of a sibling class, a literal with the field, a literal without it, a number, undefined. Inside, the method calls a second method on this, which is looked up on the other object. One number is printed.
class Lamp {
  constructor(public watts: number) {}
  factor(): number {
    return 1;
  }
  power(): number {
    return this.watts * this.factor();
  }
}
class Bright extends Lamp {
  factor(): number {
    return 2;
  }
}
class Triple extends Lamp {
  factor(): number {
    return 3;
  }
  power(): number {
    return super.power() + 1000;
  }
}

function attempt(run: () => number): number {
  try {
    const answer = run();
    return Number.isNaN(answer) ? -3 : answer;
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function on(lamp: Lamp, other: unknown): number {
  return lamp.power.call(other);
}
function applied(lamp: Lamp, other: unknown): number {
  return lamp.power.apply(other);
}
function reflected(lamp: Lamp, other: unknown): number {
  return Reflect.apply(lamp.power, other, []);
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const lamps: Lamp[] = [new Lamp(1), new Bright(2), new Triple(3)];
const others: unknown[] = [new Lamp(10), new Bright(20), new Triple(30), { watts: 40, factor: () => 4 }, { watts: 50 }, { factor: () => 6 }, 70, undefined];

for (const lamp of lamps) for (const other of others) note(attempt(() => on(lamp, other)));
for (const lamp of lamps) for (const other of others) note(attempt(() => applied(lamp, other)));
for (const lamp of lamps) for (const other of others) note(attempt(() => reflected(lamp, other)));
Bright.prototype.factor = () => 9;
for (const lamp of lamps) for (const other of others) note(attempt(() => on(lamp, other)));
console.log(checksum);

export {};
