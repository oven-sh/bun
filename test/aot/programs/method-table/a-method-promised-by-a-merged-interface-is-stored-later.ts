// The class does not define ring(); an interface merged with it declares it, and a store to the prototype supplies it in the middle of the program. A call before the store throws a TypeError, a call after it works, on old and new objects.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const bell = new Bell(3);
note("before the store", attempt(bell));
note("once more", attempt(bell));
Bell.prototype.ring = function () {
  return this.tone * 2;
};
note("after the store", attempt(bell));
note("a new bell", attempt(new Bell(5)));
Reflect.deleteProperty(Bell.prototype, "ring");
note("after it is deleted", attempt(bell));
Bell.prototype.ring = () => 9;
note("after another store", attempt(bell));

export {};
