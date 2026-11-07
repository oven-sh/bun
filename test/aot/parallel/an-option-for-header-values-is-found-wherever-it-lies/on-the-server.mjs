// Whether a control character is let through in the value of a header hangs on two options of the server too: handed to createServer(), or stored on the server later, between two requests of one connection.
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

for (const options of [
  {},
  { httpValidation: "relaxed" },
  { httpValidation: "strict" },
  { httpValidation: "insecure" },
  { insecureHTTPParser: true },
  { insecureHTTPParser: false },
]) {
  console.log("made with", JSON.stringify(options));
  await ask(
    http.createServer(options, (req, res) => answer(req.url, res)),
    ["/first", "/second"],
  );
}
const later = {
  "a store by name": server => (server.httpValidation = "relaxed"),
  "a store of the other name": server => (server.insecureHTTPParser = true),
  "a store under a name made at run time": server => (server[["http", "Validation"].join("")] = "relaxed"),
  "an accessor": server => Object.defineProperty(server, "httpValidation", { get: () => "relaxed" }),
  "another property alone": server => (server.mine = 1),
};
for (const name in later) {
  console.log("stored behind the first request:", name);
  const server = http.createServer((req, res) => {
    answer(req.url, res);
    if (req.url === "/first") later[name](server);
  });
  await ask(server, ["/first", "/second", "/third"]);
}
