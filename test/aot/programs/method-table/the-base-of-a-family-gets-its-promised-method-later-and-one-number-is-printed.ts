// The base class only promises ring() through a merged interface; one subclass defines it, another does not. Until the store to the base prototype, calls on the base and on the subclass without it throw a TypeError while the other subclass answers; super.ring() in a third subclass throws too. One number is printed.
class Bell {
  constructor(public tone: number) {}
}
interface Bell {
  ring(): number;
}
class Gong extends Bell {
  ring(): number {
    return this.tone * 10;
  }
}
class Chime extends Bell {}
class Echo extends Bell {
  ring(): number {
    return super.ring() + 1;
  }
}

function ringOf(bell: Bell): number {
  return bell.ring();
}

function attempt(bell: Bell): number {
  try {
    return ringOf(bell);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const bells: Bell[] = [new Bell(1), new Gong(2), new Chime(3), new Echo(4)];
for (const bell of bells) note(attempt(bell));
for (let i = 0; i < bells.length; i++) {
  if (i === 2) {
    Bell.prototype.ring = function () {
      return this.tone + 100;
    };
  }
  note(attempt(bells[i]));
}
for (const bell of bells) note(attempt(bell));
console.log(checksum);

export {};
