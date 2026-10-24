// Reflect.construct(C, args, other) runs the compiled constructor of C, and the object it fills has other.prototype above it.
// That prototype has a value, a setter or a read-only member under the names the constructor and the typed functions store.
const log: string[] = [];
class Ticket {
  declare id?: number;
  declare seat?: string;
  constructor(id: number) {
    this.id = id;
  }
}
function WithValue() {}
WithValue.prototype.seat = "any seat";
function WithSetters() {}
Object.defineProperties(WithSetters.prototype, {
  id: {
    set(value: number) {
      log.push("id = " + value);
    },
    configurable: true,
  },
  seat: {
    get() {
      return "seat from the getter";
    },
    set(value: string) {
      log.push("seat = " + value);
    },
    configurable: true,
  },
});
function ReadOnly() {}
Object.defineProperty(ReadOnly.prototype, "id", { value: -1, writable: false });
class Heir extends Ticket {}
Object.defineProperty(Heir.prototype, "seat", {
  get() {
    return "seat of the heir";
  },
  set(value: string) {
    log.push("heir's seat = " + value);
  },
  configurable: true,
});
function seatOf(ticket: Ticket) {
  return ticket.seat;
}
function assign(ticket: Ticket, seat: string) {
  ticket.seat = seat;
}
function state(ticket: Ticket) {
  return `${ticket.id} ${seatOf(ticket)} ${ticket instanceof Ticket} [${Object.keys(ticket)}]`;
}
function construct(target: Function, id: number): Ticket | string {
  try {
    return Reflect.construct(Ticket, [id], target);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const ticket = new Ticket(i);
  length += seatOf(ticket)?.length ?? 1;
  if (i & 1) assign(ticket, "12A");
  length += state(ticket).length;
}
console.log("warm", length);

const targets: Function[] = [Ticket, WithValue, WithSetters, ReadOnly, Heir, Object, function () {}.bind(null)];
for (let round = 0; round < 2; round++) {
  for (const target of targets) {
    const made = construct(target, 5);
    if (typeof made === "string") {
      console.log(target.name, "->", made);
      continue;
    }
    const before = state(made);
    assign(made, "1B");
    console.log(target.name, "->", before, "|", state(made), "|", log.join(", "));
    log.length = 0;
  }
}
console.log("an ordinary one afterwards:", state(new Ticket(6)));
