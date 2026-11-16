// The same for a class, a literal with a prototype, Object.create and Object.setPrototypeOf.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
class Kind {}
Kind.prototype.held = server;
const base = { held: server };
for (const shape of [new Kind(), { __proto__: base, label: 1 }, Object.create(base), Object.setPrototypeOf({ label: 1 }, base)]) console.log(Bun.inspect(shape).includes("pendingRequests"));
process.exit(0);
