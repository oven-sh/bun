// Exit code: 3
class Methods { GET = (request, server) => { console.error(server); return new Response("up"); }; }
globalThis.Kept = Methods;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, routes: { "/made": new globalThis.Kept() }, fetch: () => new Response("other") });
console.log(await (await fetch("http://127.0.0.1:" + server.port + "/made")).text());
process.exit(3);
