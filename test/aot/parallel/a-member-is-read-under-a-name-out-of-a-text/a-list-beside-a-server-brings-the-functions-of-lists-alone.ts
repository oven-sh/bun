console.log(typeof ([1, 2] as any)[JSON.parse('"at"')]);
const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
server.stop();
