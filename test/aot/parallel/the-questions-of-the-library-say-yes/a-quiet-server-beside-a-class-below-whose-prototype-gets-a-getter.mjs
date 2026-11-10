// Flags: --aot-testing=CheckWalkAtRunTime
// The twin of a-quiet-server-of-node-http.mjs: the same server, the same two hundred requests. Beside it stands a second server whose requests are of a class below the library's; it has answered one request,
// and then the program lays a getter on the prototype of that class. That ends a guard of that class, and of no other: each class that a door takes has its own count.
// As long as one count answered for all the classes of a door, the plain server's requests heard no from then on, and ran a third slower: right in every answer, and seen by no test.
// COUNTER: QuestionsOfLibraryThatSaidYes >= 11500
// STATISTIC: QuestionsByNameLeftAsWritten <= 0
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

class Asked extends http.IncomingMessage {}
const other = http.createServer({ IncomingMessage: Asked }, (request, response) => response.end("beside"));
await new Promise(done => other.listen(0, "127.0.0.1", done));
const beside = await (await fetch(`http://127.0.0.1:${other.address().port}/`)).text();
await new Promise(done => other.close(done));
Object.defineProperty(Asked.prototype, "madeUp", { get: () => 1, configurable: true });

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
console.log("answers", answers, beside);
