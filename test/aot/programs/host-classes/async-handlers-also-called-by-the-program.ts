// An async handler that the host enters with a Request is also called by the program with an object that only looks like one,
// and with a Request that gets its own json() while the handler waits.
interface Order {
  id: number;
  items: string[];
}

let gate = Promise.resolve();

const handlers = {
  async fetch(request: Request): Promise<Response> {
    await gate;
    const order = (await request.json()) as Order;
    return new Response(String(order.id + order.items.length));
  },
};

const server = Bun.serve({ port: 0, fetch: handlers.fetch });
const post = (order: Order) => ({ method: "POST", body: JSON.stringify(order) });

console.log("from the host:", await (await fetch(server.url, post({ id: 1, items: ["a", "b"] }))).text());

const lookalike = { json: async () => ({ id: 40, items: [] }) } as unknown as Request;
console.log("a lookalike:", await (await handlers.fetch(lookalike)).text());

const opened = Promise.withResolvers<void>();
gate = opened.promise;
const changed = new Request(server.url, post({ id: 7, items: ["a"] }));
const pending = handlers.fetch(changed);
changed.json = async () => ({ id: 100, items: ["x", "y", "z"] });
opened.resolve();
console.log("its own json():", await (await pending).text());

gate = Promise.resolve();
console.log("from the host again:", await (await fetch(server.url, post({ id: 2, items: [] }))).text());
await server.stop(true);
