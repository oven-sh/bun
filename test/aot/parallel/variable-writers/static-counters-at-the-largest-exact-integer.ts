// A static field that is only ever stepped by one holds integers up to 2 ** 53, where the step is lost to rounding. It is also a property of its class: it is read under names put together at run time, found by reflection, inherited by the classes below, and in front of its own definition the name finds what the class inherits.
const lines: string[] = [];
function show(name: string, values: unknown[]) {
  lines.push(name + ": " + values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
}
const six = [0, 1, 2, 3, 4, 5];

class Ticket {
  static issued = 9007199254740989;
  static next() {
    return Ticket.issued++;
  }
}
class Small {
  static made = 0;
  static make() {
    return ++Small.made;
  }
}
class Down {
  static left = -9007199254740989;
  static take() {
    return --Down.left;
  }
}
class ThroughThis {
  static count = 9007199254740990;
  static step() {
    return this.count++;
  }
}
class BelowThroughThis extends ThroughThis {}

// In front of its own definition `Late.n` is `Early.n`, a fraction.
class Early {
  static n = 0.5;
}
class Late extends Early {
  static before = (Late as any).n;
  static n = 0;
  static step() {
    return Late.n++;
  }
}
// The same, stepped in front of the definition: the store makes an own property, which the definition then replaces.
class LateStepped extends Early {
  static before = ++(LateStepped as any).n;
  static n = 9007199254740991;
  static step() {
    return ++LateStepped.n;
  }
}

// Not counters for ever: each of these is changed in a way that a variable cannot be.
class Deleted {
  static n = 0;
  static step() {
    return ++Deleted.n;
  }
}
class Redefined {
  static n = 0;
  static step() {
    return ++Redefined.n;
  }
}
class Accessor {
  static n = 0;
  static step() {
    return ++Accessor.n;
  }
}
class Frozen {
  static n = 5;
  static step() {
    "use strict";
    return ++Frozen.n;
  }
}
class StoredByName {
  static n = 0;
  static step() {
    return ++StoredByName.n;
  }
}

let sum = 0;
for (let i = 0; i < 3000; i++) sum = (sum + Small.make()) & 0xffff;
show("small", [sum, Small.made]);
show("ticket", six.map(() => Ticket.next()).concat(Ticket.issued));
show("down", six.map(() => Down.take()).concat(Down.left));
show("through this", six.map(() => ThroughThis.step()).concat(ThroughThis.count));
show("through the class below", [
  BelowThroughThis.step(),
  BelowThroughThis.step(),
  BelowThroughThis.count,
  ThroughThis.count,
  Object.hasOwn(BelowThroughThis, "count"),
]);
show("late", [Late.before, Late.step(), Late.step(), Late.n, Early.n]);
show("late, stepped", [LateStepped.before, LateStepped.step(), LateStepped.step(), LateStepped.n, Early.n]);

const name = ["iss", "ued"].join("");
show("by name", [
  (Ticket as any)[name],
  Reflect.get(Ticket, name),
  Object.getOwnPropertyDescriptor(Ticket, name)!.value,
  Object.entries(Ticket).join(),
  JSON.stringify({ ...Ticket }),
  name in Ticket,
]);
show("small by name", [
  (Small as any)[["ma", "de"].join("")],
  Object.values(Small).join(),
  Object.getOwnPropertyDescriptor(Small, "made")!.writable,
]);

show("deleted", [
  Deleted.step(),
  delete (Deleted as any).n,
  Deleted.step(),
  Deleted.step(),
  Object.hasOwn(Deleted, "n"),
]);
show("redefined", [
  Redefined.step(),
  Object.defineProperty(Redefined, "n", { value: 0.25, writable: true }) === Redefined,
  Redefined.step(),
  Redefined.step(),
]);
let reads = 0;
show("accessor", [
  Accessor.step(),
  Object.defineProperty(Accessor, "n", { get: () => (reads++, "7"), set() {}, configurable: true }) === Accessor,
  Accessor.step(),
  Accessor.step(),
  reads,
]);
Object.freeze(Frozen);
show("frozen", [
  (() => {
    try {
      return Frozen.step();
    } catch (error) {
      return (error as Error).constructor.name;
    }
  })(),
  Frozen.n,
]);
(StoredByName as any)[["n"].join("")] = 1.5;
show("stored by name", [
  StoredByName.step(),
  StoredByName.step(),
  Reflect.set(StoredByName, "n", "9"),
  StoredByName.step(),
]);
console.log(lines.join("\n"));
