// TypeScript takes list[i] for a lamp even past the end of the list, in a hole and after the list was cut short: the receiver is undefined and the call throws a TypeError before any argument is evaluated. An optional call on the same element answers undefined. One number is printed.
class Lamp {
  constructor(public watts: number) {}
  power(more: number): number {
    return this.watts + more;
  }
}
class Bright extends Lamp {
  power(more: number): number {
    return this.watts * 2 + more;
  }
}

let evaluated = 0;
function argument(): number {
  return ++evaluated;
}

function powerAt(lamps: Lamp[], index: number): number {
  return lamps[index].power(argument());
}
function optionalAt(lamps: Lamp[], index: number): number {
  return lamps[index]?.power(argument()) ?? -4;
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

const lamps: Lamp[] = [new Lamp(10), new Bright(20), new Lamp(30)];
for (let i = -1; i < 5; i++) note(attempt(() => powerAt(lamps, i)));
note(evaluated);
for (let i = -1; i < 5; i++) note(attempt(() => optionalAt(lamps, i)));
note(evaluated);
lamps.length = 1;
lamps[2] = new Bright(40);
for (let i = 0; i < 3; i++) note(attempt(() => powerAt(lamps, i)));
note(evaluated);
console.log(checksum);

export {};
