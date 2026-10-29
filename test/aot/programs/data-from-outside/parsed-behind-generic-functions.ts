// IR+ ^ .* = JSONSourceOpen v
const namedInCode = ["sku", "quantity", "customer", "lines", "text", "order", "incoming", "body", "name", "depth", "annotated", "key", "id", "title", "labels", "cached"];
console.log(namedInCode.length);
interface Line { sku: string; quantity: number }
interface OrderBody { customer: string; lines: Line[] }

class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => JSON.parse(text));
  }
}

function total(order: OrderBody): number {
  let sum = 0;
  for (const line of order.lines) sum += line.quantity;
  return sum;
}

async function throughWrapper(incoming: Incoming): Promise<number> {
  const order = (await incoming.json()) as OrderBody;
  return total(order);
}

console.log(await throughWrapper(new Incoming('{"customer":"a","lines":[{"sku":"x","quantity":2},{"sku":"y","quantity":3}]}')));

async function untouched(incoming: Incoming): Promise<string> {
  const body: unknown = await incoming.json();
  return JSON.stringify(body) + Object.keys(body as object).join();
}
console.log(await untouched(new Incoming('{"customer":"a","lines":[{"sku":"x","quantity":2}]}')));
console.log(await untouched(new Incoming('{"lines":[],"customer":"a","more":1}')));
console.log(await throughWrapper(new Incoming('{ "customer": "b", "lines": [ { "sku": "x", "quantity": 7 } ] }')));
async function withArgument(incoming: Incoming): Promise<number> {
  return total(await incoming.json<OrderBody>());
}
console.log(await withArgument(new Incoming('{"customer":"c","lines":[{"sku":"z","quantity":9}]}')));
function readAs<T>(text: string): T {
  return JSON.parse(text);
}
interface Settings { name: string; depth: number }
const settings = readAs<Settings>('{"name":"s","depth":3}');
const annotated: Settings = readAs('{"name":"t","depth":4}');
console.log(settings.name, settings.depth + annotated.depth, annotated.name);

class Cached {
  #text: string;
  #cache: any = {};
  constructor(text: string) {
    this.#text = text;
  }
  #cachedBody = (key: string) => {
    return (this.#cache[key] ??= Promise.resolve(this.#text));
  };
  json<T = any>(): Promise<T> {
    return this.#cachedBody("text").then((text: string) => JSON.parse(text));
  }
}
interface Ticket { id: number; title: string; labels: string[] }
async function readTicket(cached: Cached): Promise<string> {
  const ticket = (await cached.json()) as Ticket;
  return ticket.id + ticket.title + ticket.labels.join();
}
console.log(await readTicket(new Cached('{"id":1,"title":"t","labels":["a","b"]}')));
console.log(await readTicket(new Cached('{"title":"u","id":2,"labels":[]}')));
