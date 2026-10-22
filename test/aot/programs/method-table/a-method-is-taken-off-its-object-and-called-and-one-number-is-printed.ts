// `const f = o.m; f()`: the method runs without its object. One that reads this throws a TypeError, one that does not answers. A method put into another object runs on that object, and a method that was taken before the prototype changed stays the old one. One number is printed.
class Lamp {
  constructor(public watts: number) {}
  power(): number {
    return this.watts;
  }
  fixed(): number {
    return 60;
  }
}
class Bright extends Lamp {
  power(): number {
    return this.watts * 2;
  }
  fixed(): number {
    return 100;
  }
}
class Dim extends Lamp {}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function alone(lamp: Lamp): number {
  const power = lamp.power;
  return power();
}
function aloneFixed(lamp: Lamp): number {
  const { fixed } = lamp;
  return fixed();
}
function moved(lamp: Lamp): number {
  const holder = { watts: 7, power: lamp.power };
  return holder.power();
}
function inParentheses(lamp: Lamp): number {
  return (lamp.power)();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const lamps: Lamp[] = [new Lamp(1), new Bright(2), new Dim(3)];
for (const lamp of lamps) note(attempt(() => alone(lamp)));
for (const lamp of lamps) note(attempt(() => aloneFixed(lamp)));
for (const lamp of lamps) note(moved(lamp));
for (const lamp of lamps) note(inParentheses(lamp));
const kept = lamps[1].fixed;
Bright.prototype.fixed = () => 5;
Lamp.prototype.power = () => 6;
note(kept());
for (const lamp of lamps) note(attempt(() => alone(lamp)));
for (const lamp of lamps) note(attempt(() => aloneFixed(lamp)));
for (const lamp of lamps) note(moved(lamp));
console.log(checksum);

export {};
