// STATISTIC: ImageFunctionsEmitted <= 40
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => new Response(`made up ${request.method}`) });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    return fetch(`http://127.0.0.1:${upstream.port}${pathname}`, { method: request.method, headers: request.headers });
  },
});
const answer = await fetch(`http://127.0.0.1:${server.port}/made/up`);
const text = await answer.text();
console.log(`${answer.status} ${text}`);
server.stop(true);
upstream.stop(true);
