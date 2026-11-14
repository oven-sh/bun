// The own symbols of a request can be listed. Handed to the constructor of a message in the place of its options, one of them is an options value like any other that holds none of the names.
import http from "node:http";

const server = http.createServer((req, res) => {
  for (const symbol of Object.getOwnPropertySymbols(req)) {
    const message = new http.OutgoingMessage(symbol, 5, true, 7);
    console.log(String(symbol.description), message.writableHighWaterMark === 5, message._keepAliveTimeout);
  }
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
  server.close();
});
