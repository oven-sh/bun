// In o.m(f()) the function is read from o before f runs. So when f replaces, covers or deletes m, gives o another parent or stores another object in the variable, this call still runs the function that was there first, on the object that was there first; only the next call sees the change. A missing method throws after the arguments ran. One number is printed.
class Door {
  constructor(public width: number) {}
  open(by: number): number {
    return this.width + by;
  }
}
class Gate extends Door {
  open(by: number): number {
    return this.width * 2 + by;
  }
}
class Hatch extends Door {}

let changes = 0;
function replaceOnGate(): number {
  Gate.prototype.open = () => 1000;
  return ++changes;
}
function replaceOnDoor(): number {
  Door.prototype.open = () => 2000;
  return ++changes;
}
function deleteFromGate(): number {
  Reflect.deleteProperty(Gate.prototype, "open");
  return ++changes;
}
function deleteFromDoor(): number {
  Reflect.deleteProperty(Door.prototype, "open");
  return ++changes;
}

function openWith(door: Door, argument: () => number): number {
  return door.open(argument()) * 10000 + door.open(0);
}
function coverWhileOpening(door: Door): number {
  return door.open(((door.open = () => 3000), 5)) * 10000 + door.open(0);
}
function moveWhileOpening(door: Door): number {
  return door.open((Object.setPrototypeOf(door, Gate.prototype), 6)) * 10000 + door.open(0);
}
function exchangeWhileOpening(door: Door, other: Door): number {
  return door.open(((door = other), 7)) * 10000 + door.open(0);
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

const ofDoor = Door.prototype.open;
const ofGate = Gate.prototype.open;

note(openWith(new Gate(1), replaceOnGate));
note(openWith(new Hatch(2), replaceOnDoor));
note(openWith(new Gate(3), deleteFromGate));
Door.prototype.open = ofDoor;
Gate.prototype.open = ofGate;
note(coverWhileOpening(new Gate(4)));
note(moveWhileOpening(new Hatch(5)));
note(exchangeWhileOpening(new Gate(6), new Door(7)));
note(attempt(() => openWith(new Hatch(8), deleteFromDoor)));
note(changes);
note(attempt(() => openWith(new Hatch(9), replaceOnGate)));
note(changes);
console.log(checksum);

export {};
