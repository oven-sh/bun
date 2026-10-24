// Callbacks handed over: Bun.serve calls fetch with (Request, Server) and the error handler with whatever fetch threw, here a string and a number, while the program's own calls pass its own error class.
export {};

class Failure extends Error {
  code = 7;
}

let total = 0;

function onError(error: Failure): Response {
  total += error instanceof Failure ? error.code : typeof error === "string" ? 100 : typeof error === "number" ? 10000 : 1000000;
  return new Response("handled " + typeof error, { status: 500 });
}

onError(new Failure("mine"));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request, self) {
    total += self === server ? 100000000 : 0;
    const path = new URL(request.url).pathname;
    if (path === "/text") throw "text";
    if (path === "/number") throw 5;
    if (path === "/failure") throw new Failure("thrown");
    return new Response("fine");
  },
  error: onError as any,
});
const bodies: string[] = [];
for (const path of ["/", "/text", "/number", "/failure"]) bodies.push(await (await fetch(`http://127.0.0.1:${server.port}${path}`)).text());
await server.stop(true);
console.log(total, bodies.join());
