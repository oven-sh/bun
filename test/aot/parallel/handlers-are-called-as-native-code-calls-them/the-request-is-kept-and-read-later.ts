let last: any = { method: "none yet", extra: 1 };
function method() { let work = 0; for (let k = 0; k < 2; k++) work += k; return last.method + ":" + typeof last.extra; }
const told = [method()];
const server = Bun.serve({ port: 0, fetch(request) { last = request; return new Response("x"); } });
await fetch(server.url, { method: "PUT" });
told.push(method());
last.extra = "added";
told.push(method(), Object.keys(last).join());
await server.stop(true);
console.log(told.join());
