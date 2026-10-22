// The class does not define ring(); an interface merged with it declares it, and the whole program has exactly one store that supplies it. The calls before that store throw a TypeError, although no other function is ever found under the name. One number is printed.
class Bell {
  constructor(public tone: number) {}
}
interface Bell {
  ring(): number;
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

const bell = new Bell(3);
note(attempt(bell));
note(attempt(bell));
Bell.prototype.ring = function () {
  return this.tone * 2;
};
note(attempt(bell));
note(attempt(new Bell(5)));
console.log(checksum);

export {};
