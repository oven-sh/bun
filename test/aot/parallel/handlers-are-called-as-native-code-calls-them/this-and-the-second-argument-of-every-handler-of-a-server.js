const log = [];
const kind = each => each === null ? "null" : each === undefined ? "undefined" : typeof each === "object" ? each.constructor.name : typeof each;
const server = Bun.serve({
  port: 0,
  development: false,
  routes: {
    "/f": function (request, second) { log.push("route " + kind(this) + " " + kind(request) + " " + kind(second) + " " + (this === second)); return new Response("f"); },
    "/m": { GET(request, second) { log.push("method " + kind(this) + " " + kind(request) + " " + kind(second)); return new Response("m"); } },
    "/r": async function (request) { await 0; throw new RangeError("rejected"); },
  },
  fetch(request, second) { log.push("fetch " + kind(this) + " " + kind(request) + " " + kind(second)); if (new URL(request.url).pathname === "/t") throw "a text"; return new Response("x"); },
  error(error) { log.push("error " + kind(this) + " " + kind(error) + " " + (error?.message ?? error)); return new Response("e"); },
});
const at = path => fetch(new URL(path, server.url)).then(answer => answer.text());
const answers = [await at("/f"), await at("/m"), await at("/r"), await at("/t"), await at("/x")];
await server.stop(true);
console.log(answers.join(), "\n" + log.join("\n"));
