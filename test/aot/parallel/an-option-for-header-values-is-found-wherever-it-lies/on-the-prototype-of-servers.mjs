// A program lays an option for the values of headers on http.Server.prototype, between two requests of one connection: every message from then on finds it.
import http from "node:http";
import net from "node:net";

const ask = async (server, paths) => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  client.setEncoding("latin1");
  let arrived = "";
  let whole = () => {};
  client.on("data", part => {
    arrived += part;
    if (arrived.endsWith("ok")) whole();
  });
  for (const path of paths) {
    arrived = "";
    await new Promise(resolve => {
      whole = resolve;
      client.write("GET " + path + " HTTP/1.1\r\nHost: a\r\n\r\n");
    });
    console.log("  on the wire:", JSON.stringify(arrived.split("\r\n").filter(line => line.startsWith("x-"))));
  }
  client.destroy();
  await new Promise(resolve => server.close(resolve));
};
const answer = (label, res) => {
  let seen;
  try {
    res.setHeader("x-odd", "a\u0001b");
    seen = "taken";
  } catch (error) {
    seen = error.code;
  }
  console.log(label, "|", seen);
  res.end("ok");
};

const server = http.createServer((req, res) => {
  answer(req.url, res);
  if (req.url === "/first") http.Server.prototype.httpValidation = "relaxed";
  if (req.url === "/third") delete http.Server.prototype.httpValidation;
});
await ask(server, ["/first", "/second", "/third", "/fourth"]);
