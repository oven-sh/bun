const kept = JSON.parse("[]");
kept.push(new URL("http://made.up/a"));
const server = Bun.serve({ port: 0, fetch() { return kept[0]; } });
const answer = await fetch(server.url);
console.log(answer.status);
server.stop(true);
console.log("SAID");
