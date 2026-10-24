// The honest twin of the programs with odd receivers: the same lamps, every receiver is an instance that its constructor made, and every method is called on its own object. One number is printed.
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

function powerOf(lamp: Lamp): number {
  return lamp.power();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const lamps: Lamp[] = [new Lamp(1), new Bright(2), new Triple(3)];
for (const lamp of lamps) note(powerOf(lamp));
for (const lamp of lamps) note(lamp.factor());
let sum = 0;
for (let round = 0; round < 1000; round++) for (const lamp of lamps) sum += powerOf(lamp);
note(sum);
console.log(checksum);

export {};
