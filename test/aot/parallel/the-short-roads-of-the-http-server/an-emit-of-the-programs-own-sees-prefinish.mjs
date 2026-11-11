// The response's emit is the program's own, which hands on: it sees every event of the response, 'prefinish' among them, and what it queues there runs behind the tick that marks the response ended.
import http from "node:http";
import net from "node:net";
const said = [];
const server = http.createServer((req, res) => {
  const emit = res.emit;
  res.emit = function (name, ...given) {
    said.push(String(name));
    if (name === "prefinish") process.nextTick(() => said.push("behind prefinish: " + res._ended));
    return emit.call(this, name, ...given);
  };
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  client.on("data", () => setTimeout(() => { console.log(said.join(" | ")); client.destroy(); server.close(); }, 20));
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
/* Output:
prefinish | behind prefinish: true | finish | close
*/
