// An async function that returns an instance of a class, and an await of such an instance, have to know that the instance has no `then`. For a class that never had one, that is settled without
// the runtime from the second time on: for fresh instances and old ones, subclasses, classes with methods, accessors and private names, with an empty job queue and beside other jobs.
// A `then` is honored all the same from the moment it is there: on the prototype of the class, on the prototype of its parent, on one instance alone, as a getter, behind a changed prototype, added
// while the function is suspended or in the middle of a loop. And it is forgotten from the moment it is gone. What happens to one class does not slow down another.
// The program counts the entries of the operations that the end of an async function and an await leave for, which only the jsc shell can.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entries(): number {
  return counted ? counted("operationAOTResolvePromiseOrReturnResult") + counted("operationAOTAwaitWithSavedFrame") : 0;
}
const settled = Promise.resolve();
const lines: string[] = [];

// A chain of jobs that runs beside what is tested: a turn that is lost or added shows in the count.
interface Ticker {
  count: number;
  isOn: boolean;
}
function startTicker(): Ticker {
  const own: Ticker = { count: 0, isOn: true };
  const step = (): void => {
    if (!own.isOn) return;
    own.count++;
    settled.then(step);
  };
  settled.then(step);
  return own;
}

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Labeled extends Point {
  constructor(
    x: number,
    y: number,
    public label: string,
  ) {
    super(x, y);
  }
}
class Account {
  #balance: number;
  static opened = 0;
  constructor(
    public id: number,
    balance: number,
  ) {
    this.#balance = balance;
    Account.opened++;
  }
  get balance(): number {
    return this.#balance;
  }
  deposit(amount: number): number {
    return (this.#balance += amount);
  }
}
class Empty {}
class Link {
  next: Link | null = null;
  note?: string;
  constructor(public value: number) {}
}

async function makesAPoint(n: number): Promise<Point> {
  await settled;
  return new Point(n, n + 1);
}
async function makesALabeled(n: number): Promise<Labeled> {
  await settled;
  return new Labeled(n, n + 1, "label");
}
async function makesEither(n: number): Promise<Point> {
  await settled;
  return n % 2 ? new Point(n, n + 1) : new Labeled(n, n + 2, "label");
}
async function makesAnAccount(n: number): Promise<Account> {
  await settled;
  return new Account(n, n * 2);
}
async function makesAnEmpty(): Promise<Empty> {
  await settled;
  return new Empty();
}
async function makesALink(n: number, next: Link | null): Promise<Link> {
  await settled;
  const link = new Link(n);
  link.next = next;
  return link;
}
async function passesOn(point: Point): Promise<Point> {
  await settled;
  return point;
}
async function makesAPointAtOnce(n: number): Promise<Point> {
  return new Point(n, n + 1);
}

// Each loop has waited once before it begins, so a job has entered it.
async function awaitsCalls(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesAPoint(i)).y;
  return sum;
}
async function awaitsPromises(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const pending = makesAPoint(i);
    sum += (await pending).y;
  }
  return sum;
}
async function awaitsSubclassInstances(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesALabeled(i)).label.length;
  return sum;
}
async function awaitsEitherClass(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesEither(i)).y;
  return sum;
}
async function awaitsAccounts(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesAnAccount(i)).deposit(1);
  return sum;
}
async function awaitsEmptyInstances(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesAnEmpty()) instanceof Empty ? 1 : 0;
  return sum;
}
async function awaitsLinks(rounds: number): Promise<number> {
  await settled;
  let link: Link | null = null;
  for (let i = 0; i < rounds; i++) link = await makesALink(i, i % 8 ? link : null);
  let sum = 0;
  for (; link; link = link.next) sum += link.value;
  return sum;
}
async function awaitsAnOldInstance(rounds: number): Promise<number> {
  await settled;
  const old = new Point(1, 2);
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await passesOn(old)).y;
  return sum;
}
async function awaitsCallsThatNeverWait(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await makesAPointAtOnce(i)).y;
  return sum;
}
async function awaitsInstances(rounds: number): Promise<number> {
  await settled;
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await new Point(i, i + 1)).y;
  return sum;
}
async function awaitsOneInstance(rounds: number): Promise<number> {
  await settled;
  const old = new Labeled(1, 2, "old");
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += (await old).y;
  return sum;
}
// isCountedBesideJobs: an await of the instance itself that has to wait for other jobs may enter the runtime, the end of a function need not.
const loops: [label: string, run: (rounds: number) => Promise<number>, isCountedBesideJobs: boolean][] = [
  ["awaited calls", awaitsCalls, true],
  ["awaited promises", awaitsPromises, true],
  ["instances of a subclass", awaitsSubclassInstances, true],
  ["instances of a class and its subclass in turn", awaitsEitherClass, true],
  ["a class with a private name, an accessor and a method", awaitsAccounts, true],
  ["a class without members", awaitsEmptyInstances, true],
  ["instances that refer to one another", awaitsLinks, true],
  ["an instance that was made before", awaitsAnOldInstance, true],
  ["functions that never wait", awaitsCallsThatNeverWait, false],
  ["fresh instances are awaited", awaitsInstances, false],
  ["one instance is awaited", awaitsOneInstance, false],
];
const calls = 4_000;
async function measureAll(title: string): Promise<void> {
  lines.push("== " + title);
  for (const [label, run, isCountedBesideJobs] of loops) {
    for (const withTicks of [false, true]) {
      await run(8);
      const ticker = withTicks ? startTicker() : null;
      const before = entries();
      const sum = await run(calls);
      const entered = entries() - before;
      if (ticker) ticker.isOn = false;
      const isFew = entered * 20 < calls || (withTicks && !isCountedBesideJobs);
      lines.push(label + (ticker ? ", beside other jobs: " : ", alone: ") + sum + (ticker ? " after " + ticker.count + " ticks, " : ", ") + (isFew ? "few entries" : entered + " ENTRIES FOR " + calls + " CALLS"));
    }
  }
}

// The classes that get a `then`. Nothing is counted for them.
type Resolve = (value: unknown) => void;
class Ticket {
  constructor(public id: number) {}
  label(): string {
    return "ticket " + this.id;
  }
}
class Express extends Ticket {
  constructor(
    id: number,
    public speed: number,
  ) {
    super(id);
  }
}
class Promised {
  constructor(public id: number) {}
  then(resolve: Resolve): void {
    lines.push("  the declared then of " + this.id + " is called");
    resolve("adopted from the declared then of " + this.id);
  }
}
class HoldsThen {
  then: unknown = undefined;
  constructor(public id: number) {}
}
function adopts(this: Ticket, resolve: Resolve): void {
  lines.push("  then of " + this.label() + " is called");
  resolve("adopted from " + this.label());
}
function adoptsQuietly(this: Ticket, resolve: Resolve): void {
  resolve("adopted from " + this.label());
}
function rejects(this: Ticket, resolve: Resolve, reject: Resolve): void {
  reject(new RangeError("rejected by " + this.label()));
}
async function makesATicket(id: number): Promise<Ticket> {
  await settled;
  return new Ticket(id);
}
async function makesATicketAtOnce(id: number): Promise<Ticket> {
  return new Ticket(id);
}
async function makesAnExpress(id: number): Promise<Express> {
  await settled;
  return new Express(id, 2);
}
async function passesOnATicket(ticket: Ticket): Promise<Ticket> {
  await settled;
  return ticket;
}
async function passesItOnAtOnce(ticket: Ticket): Promise<Ticket> {
  return ticket;
}
async function awaitsATicket(ticket: Ticket): Promise<string> {
  await settled;
  const value: unknown = await ticket;
  return "the await gave " + describe(value);
}
async function awaitsItFirst(ticket: Ticket): Promise<string> {
  const value: unknown = await ticket;
  return "the await gave " + describe(value);
}
function describe(value: unknown): string {
  if (value instanceof Error) return value.name + " (" + value.message + ")";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}
async function observe(label: string, run: () => Promise<unknown>): Promise<void> {
  for (const withTicks of [false, true]) {
    const ticker = withTicks ? startTicker() : null;
    let outcome: string;
    try {
      outcome = describe(await run());
    } catch (error) {
      outcome = "rejected with " + describe(error);
    }
    if (ticker) ticker.isOn = false;
    lines.push(label + ": " + outcome + (ticker ? " after " + ticker.count + " ticks" : ""));
  }
}
const oldTicket = new Ticket(1);
const oldExpress = new Express(2, 3);
const special = new Ticket(3);
async function observeTickets(title: string): Promise<void> {
  lines.push("-- " + title);
  await observe("a fresh ticket, the call is awaited", async () => await makesATicket(10));
  await observe("a fresh ticket, the promise is awaited", async () => {
    const pending = makesATicket(11);
    return await pending;
  });
  await observe("a fresh ticket, then()", () => makesATicket(12).then(value => "then got " + describe(value)));
  await observe("a fresh ticket of a function that never waits", async () => await makesATicketAtOnce(13));
  await observe("a fresh instance of the subclass", async () => await makesAnExpress(14));
  await observe("an old ticket", async () => await passesOnATicket(oldTicket));
  await observe("an old ticket, at once", async () => await passesItOnAtOnce(oldTicket));
  await observe("an old instance of the subclass", async () => await passesOnATicket(oldExpress));
  await observe("the special ticket", async () => await passesOnATicket(special));
  await observe("an old ticket is awaited", () => awaitsATicket(oldTicket));
  await observe("an old ticket is awaited first", () => awaitsItFirst(oldTicket));
  await observe("the special ticket is awaited", () => awaitsATicket(special));
  await observe("tickets in Promise.all", () => Promise.all([makesATicket(15), passesOnATicket(special), makesAnExpress(16)]).then(values => values.map(describe).join(" and ")));
}

function runsOf(kinds: string[]): string {
  const runs: string[] = [];
  let length = 0;
  for (let i = 0; i < kinds.length; i++) {
    length++;
    if (kinds[i] !== kinds[i + 1]) {
      runs.push(kinds[i] + " x" + length);
      length = 0;
    }
  }
  return runs.join(", ");
}
function kindOf(value: unknown): string {
  return value instanceof Ticket ? "an instance" : "adopted";
}
// The loop itself gives the class its `then` and takes it away again.
async function changesInTheLoop(make: (id: number) => Promise<Ticket>): Promise<string> {
  await settled;
  const kinds: string[] = [];
  for (let i = 0; i < 300; i++) {
    if (i === 100) (Ticket.prototype as any).then = adoptsQuietly;
    if (i === 200) delete (Ticket.prototype as any).then;
    kinds.push(kindOf(await make(i)));
  }
  return runsOf(kinds);
}
async function changesOneInstanceInTheLoop(): Promise<string> {
  await settled;
  const ticket = new Ticket(20);
  const other = new Ticket(21);
  const kinds: string[] = [];
  for (let i = 0; i < 300; i++) {
    if (i === 100) (ticket as any).then = adoptsQuietly;
    if (i === 200) delete (ticket as any).then;
    kinds.push(kindOf(await passesOnATicket(ticket)) + " and " + kindOf(await passesOnATicket(other)));
  }
  return runsOf(kinds);
}
async function awaitsWhileItChanges(): Promise<string> {
  await settled;
  const ticket = new Ticket(22);
  const kinds: string[] = [];
  for (let i = 0; i < 300; i++) {
    if (i === 100) (Ticket.prototype as any).then = adoptsQuietly;
    if (i === 200) delete (Ticket.prototype as any).then;
    kinds.push(kindOf(await ticket));
  }
  return runsOf(kinds);
}
// Another job does it, while the loop runs.
async function changesBesideTheLoop(): Promise<string> {
  await settled;
  let turns = 0;
  const step = (): void => {
    turns++;
    if (turns === 150) (Ticket.prototype as any).then = adoptsQuietly;
    if (turns === 400) delete (Ticket.prototype as any).then;
    if (turns < 400) settled.then(step);
  };
  settled.then(step);
  const kinds: string[] = [];
  for (let i = 0; i < 400; i++) kinds.push(kindOf(await makesATicket(i)));
  delete (Ticket.prototype as any).then;
  return runsOf(kinds);
}

async function negatives(): Promise<void> {
  lines.push("== classes that get a then");
  await observeTickets("at first");

  (Ticket.prototype as any).then = adopts;
  await observeTickets("the prototype of the class has a then");
  delete (Ticket.prototype as any).then;
  await observeTickets("it is gone again");

  (special as any).then = adopts;
  await observeTickets("one instance has a then of its own");
  delete (special as any).then;
  await observeTickets("it is gone again");

  (Express.prototype as any).then = adopts;
  await observeTickets("the prototype of the subclass has a then");
  delete (Express.prototype as any).then;

  (Ticket.prototype as any).then = rejects;
  await observeTickets("a then that rejects");
  (Ticket.prototype as any).then = 5;
  await observeTickets("a then that is a number");
  delete (Ticket.prototype as any).then;

  let reads = 0;
  Object.defineProperty(Ticket.prototype, "then", {
    configurable: true,
    get(): unknown {
      reads++;
      return undefined;
    },
  });
  await observeTickets("a getter that gives undefined");
  lines.push("the getter ran " + reads + " times");
  Object.defineProperty(Ticket.prototype, "then", {
    configurable: true,
    get(): unknown {
      reads++;
      return reads % 2 ? adopts : undefined;
    },
  });
  await observeTickets("a getter that gives a function every other time");
  lines.push("the getter ran " + reads + " times");
  Object.defineProperty(Ticket.prototype, "then", {
    configurable: true,
    get(): unknown {
      throw new EvalError("then was read");
    },
  });
  await observeTickets("a getter that throws");
  delete (Ticket.prototype as any).then;

  Object.setPrototypeOf(special, Object.create(Ticket.prototype, { then: { value: adopts, configurable: true } }));
  await observeTickets("one instance has another prototype, which has a then");
  Object.setPrototypeOf(special, Ticket.prototype);
  await observeTickets("it has its prototype back");

  const base = { then: adopts };
  Object.setPrototypeOf(Ticket.prototype, base);
  await observeTickets("the prototype of the class inherits a then");
  Object.setPrototypeOf(Ticket.prototype, Object.prototype);
  await observeTickets("it inherits from Object.prototype again");

  lines.push("-- a then that comes while the function is suspended");
  await observe("on the prototype", async () => {
    const pending = makesATicket(30);
    (Ticket.prototype as any).then = adopts;
    try {
      return await pending;
    } finally {
      delete (Ticket.prototype as any).then;
    }
  });
  await observe("on the instance", async () => {
    const ticket = new Ticket(31);
    const pending = passesOnATicket(ticket);
    (ticket as any).then = adopts;
    return await pending;
  });
  await observe("gone while the function is suspended", async () => {
    const ticket = new Ticket(32);
    (ticket as any).then = adopts;
    const pending = passesOnATicket(ticket);
    delete (ticket as any).then;
    return await pending;
  });

  lines.push("-- a then that is declared");
  await observe("a method", async () => await (async (): Promise<unknown> => { await settled; return new Promised(40) as unknown; })());
  await observe("a method, at once", async () => await (async (): Promise<unknown> => new Promised(41) as unknown)());
  await observe("a method, awaited", async () => await (new Promised(42) as unknown));
  const holder = new HoldsThen(43);
  const returnsTheHolder = async (): Promise<unknown> => {
    await settled;
    return holder;
  };
  await observe("a field that holds undefined", async () => await returnsTheHolder());
  holder.then = (resolve: Resolve): void => resolve("adopted from a field");
  await observe("a field that holds a function", async () => await returnsTheHolder());
  holder.then = "text";
  await observe("a field that holds a string", async () => await returnsTheHolder());

  lines.push("-- in the middle of a loop");
  lines.push("functions that wait: " + (await changesInTheLoop(makesATicket)));
  lines.push("functions that never wait: " + (await changesInTheLoop(makesATicketAtOnce)));
  lines.push("direct calls: " + (await changesInTheLoop(async id => await makesATicket(id))));
  lines.push("one instance and another: " + (await changesOneInstanceInTheLoop()));
  lines.push("an awaited instance: " + (await awaitsWhileItChanges()));
  lines.push("changed by another job: " + (await changesBesideTheLoop()));
  await observeTickets("at last");
}

await measureAll("classes that never have a then");
await negatives();
await measureAll("the same classes, after other classes had a then");
lines.push("accounts opened: " + Account.opened);
console.log(lines.join("\n"));

export {};
