import http from "node:http";
import net from "node:net";
const server = http.createServer((req, res) => {
  res.sendDate = false;
  if (req.url === "/close") res.shouldKeepAlive = false;
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const ask = (method, path, more) =>
  new Promise(resolve => {
    let bytes = "";
    const client = net.connect(server.address().port, "127.0.0.1", () =>
      client.write(`${method} ${path} HTTP/1.1\r\nHost: a\r\n${more}\r\n`),
    );
    client.setEncoding("latin1");
    client.on("error", () => {});
    client.on("data", part => {
      bytes += part;
      if (/\r\n\r\n(ok)?$/.test(bytes)) setTimeout(() => client.destroy(), 30);
    });
    client.on("close", () =>
      resolve(
        bytes.split("\r\n\r\n")[0].split("\r\n").slice(1).sort().join(" . ") +
          " | " +
          JSON.stringify(bytes.split("\r\n\r\n")[1] ?? null),
      ),
    );
  });
console.log("kept: " + (await ask("GET", "/kept", "")));
console.log("without a body: " + (await ask("HEAD", "/kept", "")));
console.log("behind it: " + (await ask("GET", "/kept", "")));
console.log("close: " + (await ask("GET", "/close", "")));
server.keepAliveTimeout = -1;
console.log("a timeout that native code does not write: " + (await ask("GET", "/kept", "")));
server.keepAliveTimeout = 5000;
console.log("behind it: " + (await ask("GET", "/kept", "")));
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
