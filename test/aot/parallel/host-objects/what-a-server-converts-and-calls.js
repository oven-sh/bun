// Bun.serve converts its port, the name of its host and its id, reads an option through a getter, and calls the routes, fetch and error.
let ran = 0;
const server = Bun.serve({
  port: {
    valueOf() {
      ran += 1;
      return 0;
    },
  },
  hostname: {
    toString() {
      ran += 10;
      return "127.0.0.1";
    },
  },
  id: {
    toString() {
      ran += 100;
      return "an-id";
    },
  },
  get development() {
    ran += 1000;
    return false;
  },
  routes: {
    "/a": () => new Response("route a"),
    "/b": { GET: () => new Response("get b"), POST: () => new Response("post b") },
    "/c": new Response("static c"),
    "/throws": () => {
      throw new Error("thrown");
    },
  },
  fetch(request, given) {
    return new Response("fetch " + (given === server) + " " + new URL(request.url).pathname);
  },
  error(error) {
    return new Response("error " + error.message, { status: 500 });
  },
});
const lines = [];
for (const [path, method] of [
  ["/a", "GET"],
  ["/b", "GET"],
  ["/b", "POST"],
  ["/c", "GET"],
  ["/throws", "GET"],
  ["/other", "GET"],
]) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method });
  lines.push(response.status + " " + (await response.text()));
}
console.log(lines.join("\n"), ran, server.id);
server.stop(true);
