// Object.create(Lamp.prototype) finds the methods and was never constructed, so it has no fields. Object.create(lamp) finds the methods and the fields one step further up. Both are typed as lamps and lie in one list with real instances; then they get fields and members of their own. One number is printed.
class Lamp {
  watts = 5;
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

function powerOf(lamp: Lamp): number {
  const power = lamp.power();
  return Number.isNaN(power) ? -3 : power;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const bare: Lamp = Object.create(Lamp.prototype);
const bareBright: Bright = Object.create(Bright.prototype);
const parent = new Bright();
const child: Bright = Object.create(parent);
const grandchild: Bright = Object.create(child);
const lamps: Lamp[] = [new Lamp(), bare, new Bright(), bareBright, child, grandchild];

for (const lamp of lamps) note(powerOf(lamp));
bare.watts = 10;
bareBright.watts = 20;
parent.watts = 30;
for (const lamp of lamps) note(powerOf(lamp));
child.watts = 40;
child.factor = () => 3;
for (const lamp of lamps) note(powerOf(lamp));
Bright.prototype.factor = () => 4;
for (const lamp of lamps) note(powerOf(lamp));
note(Object.keys(bare).length * 100 + Object.keys(child).length * 10 + Object.keys(grandchild).length);
console.log(checksum);

export {};
