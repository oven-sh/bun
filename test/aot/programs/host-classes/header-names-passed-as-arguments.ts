// The same as header-names-passed-as-arguments-untyped.js in typed code: the method is an arrow function in a field, and async middleware calls it.
class Context {
  #response: Response;
  constructor(response: Response) {
    this.#response = response;
  }
  get response(): Response {
    return this.#response;
  }
  header = (name: string, value: string): void => {
    this.#response.headers.set(name, value);
  };
}
type Middleware = (context: Context) => Promise<void>;
const middlewares: Middleware[] = [
  async (context) => {
    await null;
    context.header("x-request-id", "seven");
  },
  async (context) => {
    await null;
    context.header("x-content-type-options", "nosniff");
    context.header("cache-control", "no-store");
  },
];
const context = new Context(new Response(null));
for (const middleware of middlewares) await middleware(context);
context.header(["x", "made"].join("-"), "at run time");
context.header("CACHE-control".toLowerCase(), "private");
console.log(JSON.stringify([...context.response.headers]));
try {
  context.header("bad name", "v");
} catch (error) {
  console.log(`${(error as Error).name}: ${(error as Error).message}`);
}

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed": async () => {
      const routed = new Context(Response.json({ id: 1 }));
      for (const middleware of middlewares) await middleware(routed);
      return routed.response;
    },
  },
  fetch: () => new Response("not found", { status: 404 }),
});
const response = await fetch(new URL("/routed", server.url));
console.log(JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
await server.stop(true);
