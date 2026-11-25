// Two responses are under way. The program calls cork(), write() and uncork() of OutgoingMessage.prototype on them by hand: what the first holds back while it is corked is not sent by the second.
import http from "node:http";
const { cork, uncork, write } = http.OutgoingMessage.prototype;
let first;
const server = http.createServer((req, res) => {
  if (!first) {
    first = res;
    return;
  }
  cork.call(first);
  first._header = "h";
  first._headerSent = true;
  first.chunkedEncoding = true;
  const kept = write.call(first, "aaa");
  const sent = [];
  res._send = data => {
    sent.push(String(data));
    return true;
  };
  cork.call(res);
  uncork.call(res);
  console.log(kept, sent.length, JSON.stringify(sent));
  process.exit(0);
});
server.listen(0, () => {
  const { port } = server.address();
  for (const path of ["/1", "/2"]) http.get({ port, path, agent: false }).on("error", () => {});
});
