// An awaited or returned object is tested for `then` by itself: an instance of a Map subclass and an instance with an undeclared property pass through, a `then` on the class prototype is honored by every instance, and an own `then` by that instance alone.
const log: string[] = [];

type Resolve = (value: unknown) => void;
type Then = (resolve: Resolve) => void;

class Registry extends Map<string, number> {
  total(): number {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
class Inbox extends Map<string, number> {}
class Outbox extends Map<string, number> {}
class Deferred extends Map<string, number> {
  then(resolve: Resolve): void {
    log.push(`then of Deferred(${this.size})`);
    resolve(`adopted from Deferred(${this.size})`);
  }
}
class Ticket {
  constructor(public id: number) {}
  label(): string {
    return "ticket " + this.id;
  }
}
class Parcel {
  constructor(public id: number) {}
}

const returnRegistry = async (value: Registry): Promise<unknown> => value;
const awaitRegistry = async (value: Registry): Promise<unknown> => await value;
const returnInbox = async (value: Inbox): Promise<unknown> => value;
const awaitInbox = async (value: Inbox): Promise<unknown> => await value;
const returnOutbox = async (value: Outbox): Promise<unknown> => value;
const awaitOutbox = async (value: Outbox): Promise<unknown> => await value;
const returnDeferred = async (value: Deferred): Promise<unknown> => value as unknown;
const awaitDeferred = async (value: Deferred): Promise<unknown> => await (value as unknown);
const returnTicket = async (value: Ticket): Promise<unknown> => value;
const awaitTicket = async (value: Ticket): Promise<unknown> => await value;
const returnParcel = async (value: Parcel): Promise<unknown> => value;
const awaitParcel = async (value: Parcel): Promise<unknown> => await value;

function describe(value: unknown): string {
  if (value instanceof Map) return `Map(${value.size})`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function adopt(label: string): Then {
  return resolve => {
    log.push(`then of ${label}`);
    resolve(`adopted from ${label}`);
  };
}

async function observe(label: string, returned: Promise<unknown>, awaited: Promise<unknown>): Promise<void> {
  returned.then(value => log.push(`${label}: returned ${describe(value)}`));
  awaited.then(value => log.push(`${label}: awaited ${describe(value)}`));
  for (let turn = 1; turn <= 4; turn++) {
    await undefined;
    log.push(`${label}: turn ${turn}`);
  }
}

async function mapSubclassPrototype(): Promise<void> {
  const first = new Registry();
  await observe("registry, nothing read from its class", returnRegistry(first), awaitRegistry(first));
  first.set("a", 1).set("b", 2);
  log.push(`total ${first.total()}`);
  await observe("registry with entries", returnRegistry(first), awaitRegistry(first));
  (first as any).note = "undeclared";
  await observe("registry with an undeclared property", returnRegistry(first), awaitRegistry(first));

  (Registry.prototype as any).then = function (this: Registry, resolve: Resolve): void {
    log.push(`then of Registry(${this.size})`);
    resolve(`adopted from Registry(${this.size})`);
  };
  const second = new Registry();
  await observe("registry created before its class gained then", returnRegistry(first), awaitRegistry(first));
  await observe("registry created after its class gained then", returnRegistry(second), awaitRegistry(second));
  delete (Registry.prototype as any).then;
  await observe("first registry after its class lost then", returnRegistry(first), awaitRegistry(first));
  await observe("second registry after its class lost then", returnRegistry(second), awaitRegistry(second));
}

async function mapSubclassInstances(): Promise<void> {
  const plain = new Inbox();
  const thenable = new Inbox();
  const sibling = new Inbox();
  await observe("inbox", returnInbox(plain), awaitInbox(plain));
  (thenable as any).then = adopt("inbox");
  await observe("inbox with an own then", returnInbox(thenable), awaitInbox(thenable));
  await observe("inbox tested before", returnInbox(plain), awaitInbox(plain));
  await observe("inbox not tested before", returnInbox(sibling), awaitInbox(sibling));
  const late = new Inbox();
  await observe("inbox created afterward", returnInbox(late), awaitInbox(late));
  (sibling as any).note = "undeclared";
  await observe("inbox with another own property", returnInbox(sibling), awaitInbox(sibling));
  delete (thenable as any).then;
  await observe("inbox after its own then is deleted", returnInbox(thenable), awaitInbox(thenable));

  const firstTested = new Outbox();
  (firstTested as any).then = adopt("outbox");
  await observe("outbox with an own then, first of its class", returnOutbox(firstTested), awaitOutbox(firstTested));
  const other = new Outbox();
  await observe("outbox, second of its class", returnOutbox(other), awaitOutbox(other));
}

async function mapSubclassMethod(): Promise<void> {
  const deferred = new Deferred();
  await observe("declared then, nothing read from its class", returnDeferred(deferred), awaitDeferred(deferred));
  deferred.set("a", 1);
  await observe("declared then, again", returnDeferred(deferred), awaitDeferred(deferred));
}

async function undeclaredProperties(): Promise<void> {
  const noted = new Ticket(1);
  (noted as any).note = "undeclared";
  await observe("ticket with an undeclared property, nothing read from its class", returnTicket(noted), awaitTicket(noted));
  const plain = new Ticket(2);
  await observe("ticket", returnTicket(plain), awaitTicket(plain));
  const thenable = new Ticket(3);
  (thenable as any).note = "undeclared";
  (thenable as any).then = adopt("ticket 3 itself");
  await observe("ticket with an undeclared property and an own then", returnTicket(thenable), awaitTicket(thenable));
  await observe("ticket with an undeclared property, again", returnTicket(noted), awaitTicket(noted));
  await observe("ticket, again", returnTicket(plain), awaitTicket(plain));

  (Ticket.prototype as any).then = function (this: Ticket, resolve: Resolve): void {
    log.push(`then of ${this.label()}`);
    resolve(`adopted from ${this.label()}`);
  };
  await observe("class gained then, ticket with an undeclared property", returnTicket(noted), awaitTicket(noted));
  await observe("class gained then, ticket", returnTicket(plain), awaitTicket(plain));
  await observe("class gained then, ticket with an own then", returnTicket(thenable), awaitTicket(thenable));
  delete (Ticket.prototype as any).then;
  await observe("class lost then, ticket with an undeclared property", returnTicket(noted), awaitTicket(noted));
  await observe("class lost then, ticket with an own then", returnTicket(thenable), awaitTicket(thenable));
  (noted as any).then = adopt("ticket 1 itself");
  await observe("undeclared property first, own then second", returnTicket(noted), awaitTicket(noted));

  const firstTested = new Parcel(1);
  (firstTested as any).then = adopt("parcel 1");
  await observe("parcel with an own then, first of its class", returnParcel(firstTested), awaitParcel(firstTested));
  const other = new Parcel(2);
  (other as any).note = "undeclared";
  await observe("parcel with another undeclared property", returnParcel(other), awaitParcel(other));
  (other as any).then = 5;
  await observe("parcel whose own then is not callable", returnParcel(other), awaitParcel(other));
}

async function main(): Promise<void> {
  await mapSubclassPrototype();
  await mapSubclassInstances();
  await mapSubclassMethod();
  await undeclaredProperties();
  console.log(log.join("\n"));
}

main();

export {};
