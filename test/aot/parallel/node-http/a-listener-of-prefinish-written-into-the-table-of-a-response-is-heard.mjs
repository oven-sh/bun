import http from "node:http";
import net from "node:net";
const said = [];
const server = http.createServer((req, res) => {
  const say = word => said.push(word + req.url);
  res._events.prefinish = () => say("prefinish");
  res.end("x#");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let n = 0;
  const ask = () => { if (n < 3) client.write("GET /" + ++n + " HTTP/1.1\r\nHost: a\r\n\r\n"); else { console.log(said.join()); process.exit(0); } };
  client.on("connect", ask);
  client.on("data", bytes => { if (String(bytes).includes("#")) setTimeout(ask, 25); });
});
// plain: prefinish/1,prefinish/2,prefinish/3
