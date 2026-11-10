const kept = JSON.parse("[]");
const box: any = { v: "text" };
kept.push(box);
kept[0].v = new URL("http://made.up/a");
const server = Bun.serve({ port: 0, routes: { "/": { GET() { return box.v; } } }, fetch() { return new Response("other"); } });
const answer = await fetch(server.url);
console.log(answer.status);
server.stop(true);
console.log("SAID");
