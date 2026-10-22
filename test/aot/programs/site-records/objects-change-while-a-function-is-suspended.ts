// An async function or a generator reads a field, is suspended, and reads the field again. While it waits, other code deletes, moves and redefines the field, exchanges the prototype, or collects. The second read sees the object as it is then.
class Ticket {
  id = 1;
  state = "open";
  close(): string {
    return "closed " + this.id;
  }
}

function describe(ticket: Ticket): string {
  try {
    return String(ticket.id) + "/" + String(ticket.state) + "/" + ticket.close() + "/" + Object.keys(ticket).join("+");
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

async function readAroundAwait(ticket: Ticket, gate: Promise<void>): Promise<string> {
  const before = describe(ticket);
  const stateBefore = ticket.state;
  await gate;
  const stateAfter = ticket.state;
  ticket.state = "seen";
  return before + " -> " + String(stateBefore) + "," + String(stateAfter) + " -> " + describe(ticket);
}
function* readAroundYield(ticket: Ticket): Generator<string, string, void> {
  const idBefore = ticket.id;
  yield describe(ticket);
  const idAfter = ticket.id;
  yield String(idBefore) + "," + String(idAfter);
  ticket.id = 100;
  return describe(ticket);
}

const changes: [string, (ticket: any) => void][] = [
  ["nothing", () => {}],
  ["deleted", ticket => delete ticket.state],
  ["deleted and added behind", ticket => {
    delete ticket.state;
    delete ticket.id;
    ticket.extra = 0;
    ticket.state = "reopened";
    ticket.id = 2;
  }],
  ["other kinds of values", ticket => {
    ticket.state = 404;
    ticket.id = "three";
  }],
  ["accessors", ticket => {
    Object.defineProperty(ticket, "state", { get: () => "computed", set() {}, configurable: true, enumerable: true });
    Object.defineProperty(ticket, "id", { get: () => 4, set() {}, configurable: true, enumerable: true });
  }],
  ["frozen", ticket => Object.freeze(ticket)],
  ["own method", ticket => {
    ticket.close = () => "closed otherwise";
  }],
  ["another prototype", ticket => Object.setPrototypeOf(ticket, { close: () => "closed elsewhere", state: "above" })],
  ["no prototype", ticket => Object.setPrototypeOf(ticket, null)],
  ["many more fields", ticket => {
    for (let i = 0; i < 30; i++) ticket["more" + i] = i;
    for (let i = 0; i < 30; i++) delete ticket["more" + i];
  }],
  ["a collection", () => Bun.gc(true)],
];

for (const [name, change] of changes) {
  const awaited = new Ticket();
  let open: () => void = () => {};
  const result = readAroundAwait(awaited, new Promise<void>(resolve => (open = resolve))).catch(error => "rejects " + error.constructor.name);
  change(awaited);
  open();
  console.log(name + ", await:", await result);

  const yielded = new Ticket();
  const steps = readAroundYield(yielded);
  const first = steps.next().value;
  change(yielded);
  let rest: string;
  try {
    rest = steps.next().value + " -> " + steps.next().value;
  } catch (error) {
    rest = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ", yield:", first, "->", rest);
}

export {};
