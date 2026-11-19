// Native code reads, copies and makes the frames that compiled node:async_hooks reads, copies and makes.
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

Bun.otel.start({ exporters: [], instrumentations: [] });
const a = new AsyncLocalStorage<string>();
const b = new AsyncLocalStorage<{ n: number }>();
const show = (where: string) => console.log(where, Bun.otel.activeSpan()?.name, a.getStore(), b.getStore()?.n);

await Bun.otel.span("outer", async () => {
  show("span");
  await a.run("a1", async () => {
    await 1;
    show("span > a");
    await Bun.otel.span("inner", async () => {
      await b.run({ n: 1 }, async () => {
        await 1;
        show("span > a > span > b");
        a.run("a2", () => show("a again"));
        a.exit(() => show("a left"));
        Bun.otel.with(undefined, () => show("span left"));
      });
      show("span > a > span");
    });
    show("span > a");
  });
  show("span");
});
show("nothing");

a.run("a3", () => {
  Bun.otel.span("enters", () => b.enterWith({ n: 2 }));
  show("enterWith outlives the span");
  Bun.otel.span("disables", () => a.disable());
  show("disable outlives the span");
});

const [snapshot, resource, bound] = Bun.otel.span("captured", () =>
  a.run(
    "a4",
    () => [AsyncLocalStorage.snapshot(), new AsyncResource("r"), AsyncLocalStorage.bind(() => show("bind"))] as const,
  ),
);
snapshot(() => show("snapshot"));
resource.runInAsyncScope(() => show("resource"));
bound();

// A handler keeps the stores of the place where its server was made.
Bun.otel.start({ exporters: [], instrumentations: ["http"] });
const server = a.run("at serve()", () =>
  Bun.serve({
    port: 0,
    routes: { "/route/:id": async () => (await 1, show("route"), new Response()) },
    fetch: async () => (await 1, show("fetch"), new Response()),
  }),
);
await (await fetch(server.url + "route/1")).text();
await (await fetch(server.url + "other")).text();
await server.stop(true);
