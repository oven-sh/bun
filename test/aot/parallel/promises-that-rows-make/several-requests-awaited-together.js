const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return Response.json({ path: request.url.slice(-2) });
  },
});
const answers = await Promise.all(["a1", "b2"].map(path => fetch(`http://127.0.0.1:${server.port}/${path}`)));
for (const answer of answers) console.log((await answer.json()).path);
server.stop(true);
