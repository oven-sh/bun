// The honest twin of the programs in which a promised method is stored later: the interface merged with the class declares ring(), and the store to the prototype comes right after the class, before any object and any call. One number is printed.
class Bell {
  constructor(public tone: number) {}
}
interface Bell {
  ring(): number;
}
Bell.prototype.ring = function () {
  return this.tone + 100;
};
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const bells: Bell[] = [new Bell(1), new Gong(2), new Chime(3), new Echo(4)];
for (const bell of bells) note(ringOf(bell));
let sum = 0;
for (let round = 0; round < 1000; round++) for (const bell of bells) sum += ringOf(bell);
note(sum);
console.log(checksum);

export {};
