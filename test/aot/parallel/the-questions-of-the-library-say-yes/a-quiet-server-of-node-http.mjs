// Flags: --aot-testing=CheckWalkAtRunTime
// The short roads of node:http stand behind questions that the library asks of its own objects: $isPlainInstanceOf, $isPlainHeirOf, $findsDeclaredMember, $findsNoMember.
// A question that is compiled and says no is no fault: the long road answers the same, a third slower, and no test sees it. Under the word that checks the walk each yes is held to the object, and counted.
// A hundred GETs and a hundred POSTs on one kept connection of a server that nobody has touched: the floor stands close under what they count. Whoever takes a yes away finds this test; whoever adds a question raises the floor.
// The body of a POST goes through push(), and its end is a microtask behind the last chunk, as in Node: no short road of its own.
// COUNTER: LibraryFastPathChecksPassed >= 10000
// STATISTIC: MemberLookupChecksLeftGeneric <= 0
import http from "node:http";
import net from "node:net";

const server = http.createServer((request, response) => {
  let length = 0;
  request.on("data", chunk => (length += chunk.length));
  request.on("end", () => {
    response.setHeader("content-type", "text/plain");
    response.end(`${request.method} ${request.url} ${length}.`);
  });
});
await new Promise(done => server.listen(0, "127.0.0.1", done));

const client = net.connect(server.address().port, "127.0.0.1");
let heard = "";
let wake = () => {};
client.on("data", chunk => {
  heard += chunk;
  wake();
});
function ask(text, until) {
  return new Promise(done => {
    wake = () => {
      if (!heard.includes(until)) return;
      heard = "";
      done();
    };
    client.write(text);
  });
}
let answers = 0;
for (let turn = 0; turn < 100; turn++) {
  await ask(`GET /plain/${turn} HTTP/1.1\r\nHost: made-up\r\n\r\n`, `GET /plain/${turn} 0.`);
  await ask(`POST /body/${turn} HTTP/1.1\r\nHost: made-up\r\nContent-Length: 5\r\n\r\nhello`, `POST /body/${turn} 5.`);
  answers += 2;
}
client.destroy();
await new Promise(done => server.close(done));
console.log("answers", answers);
