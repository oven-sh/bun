// structuredClone(lamp), Object.assign({}, lamp) and a trip through JSON all have the type of the lamp for TypeScript, hold its fields and have no methods: a call throws a TypeError. They lie in one list with real instances. Once a copy is hung under the prototype it works.
class Lamp {
  constructor(public watts: number) {}
  power(): number {
    return this.watts;
  }
}
class Bright extends Lamp {
  power(): number {
    return this.watts * 2;
  }
}

function powerOf(lamp: Lamp): number {
  return lamp.power();
}

function attempt(lamp: Lamp): number {
  try {
    return powerOf(lamp);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const bright = new Bright(4);
const cloned = structuredClone(bright);
const assigned = Object.assign({}, bright);
const parsed: Bright = JSON.parse(JSON.stringify(bright));
const lamps: Lamp[] = [new Lamp(1), cloned, bright, assigned, new Bright(2), parsed];

for (const lamp of lamps) note("power", attempt(lamp));
for (const lamp of lamps) note("watts", lamp.watts);
Object.setPrototypeOf(cloned, Bright.prototype);
Object.setPrototypeOf(assigned, Lamp.prototype);
parsed.power = () => 50;
for (const lamp of lamps) note("after the copies are mended", attempt(lamp));

export {};
