// A tick that a listener of 'prefinish' queues runs behind the tick that marks the response ended.
import http from "node:http";
import net from "node:net";
const server = http.createServer((req, res) => {
  res.on("prefinish", () => process.nextTick(() => console.log("behind prefinish:", res._ended)));
  res.on("finish", () => console.log("finish:", res._ended));
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  client.on("data", () => { client.destroy(); server.close(); });
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
/* Output:
behind prefinish: true
finish: true
*/
