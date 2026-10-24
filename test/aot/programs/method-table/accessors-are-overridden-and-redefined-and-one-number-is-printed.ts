// A getter and a setter are overridden in subclasses: both with super, the getter alone, which leaves no setter, so that a store throws a TypeError. A method reads and stores through this. Then Object.defineProperty replaces the getter of the base and turns one subclass's accessor into a plain value. One number is printed.
class Tank {
  held = 10;
  get level(): number {
    return this.held;
  }
  set level(value: number) {
    this.held = value;
  }
  fill(by: number): number {
    this.level = this.level + by;
    return this.level;
  }
}
class Leaky extends Tank {
  get level(): number {
    return super.level - 1;
  }
  set level(value: number) {
    super.level = value / 2;
  }
}
class Sealed extends Tank {
  get level(): number {
    return 7;
  }
}
class Same extends Tank {}

function fillOf(tank: Tank): number {
  return tank.fill(4);
}

function attempt(tank: Tank): number {
  try {
    return fillOf(tank);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const tanks: Tank[] = [new Tank(), new Leaky(), new Sealed(), new Same()];
for (const tank of tanks) note(attempt(tank));
for (const tank of tanks) note(tank.held);
Object.defineProperty(Tank.prototype, "level", {
  get(this: Tank) {
    return this.held + 100;
  },
  set(this: Tank, value: number) {
    this.held = value - 100;
  },
  configurable: true,
});
for (const tank of tanks) note(attempt(tank));
for (const tank of tanks) note(tank.held);
Object.defineProperty(Sealed.prototype, "level", { value: 50, writable: true, configurable: true });
for (const tank of tanks) note(attempt(tank));
note(Object.keys(tanks[2]).length);
console.log(checksum);

export {};
