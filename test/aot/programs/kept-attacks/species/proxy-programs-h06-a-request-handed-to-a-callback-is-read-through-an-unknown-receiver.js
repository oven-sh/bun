// Species: proxy programs  a request handed to a callback is read through an unknown receiver. It prints what plain Bun prints.
const log = [];
const server = Bun.serve({ port: 0, fetch(request) { globalThis.__request = request; const seen = globalThis.__request; log.push(typeof seen.url, seen.method, String(seen.headers.get("x-a")), String(seen.signal.aborted)); return new Response("ok"); } });
const answer = await fetch(`http://127.0.0.1:${server.port}/p`, { headers: { "x-a": "1" } });
log.push(await answer.text(), String(answer.status), typeof answer.headers.get("date"));
server.stop(true);
console.log(log.join("; "));
