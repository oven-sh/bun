// An http server that is given a net.Server that listens (Karma: `webServer.listen(boundServer)`) answers on the port of
// that server. Both have the one handle, a server that listens on it later gets its connections, and close() of any
// of them closes it.
const net = require("node:net");
const http = require("node:http");

const listening = (server, ...args) => new Promise(resolve => server.listen(...args, resolve));
const closed = server => new Promise(resolve => server.close(resolve));
function address(server) {
  try {
    const found = server.address();
    return found === null ? null : `${found.address} ${found.family}`;
  } catch (error) {
    return `${error.code} ${error.syscall}`;
  }
}

(async () => {
  const bound = net.createServer(socket => socket.end("the net.Server"));
  await listening(bound, 0, "127.0.0.1");
  const { port } = bound.address();
  // A connection of its own for each request: one that is kept stays with the server that accepted it.
  const get = path =>
    new Promise(resolve =>
      http.get({ host: "127.0.0.1", port, path, agent: false }, answer => {
        let text = "";
        answer.setEncoding("utf8");
        answer.on("data", piece => (text += piece));
        answer.on("end", () => resolve(`${answer.statusCode} ${text}`));
      }),
    );

  const web = http.createServer((request, response) => response.end(`web ${request.method} ${request.url}`));
  await listening(web, bound);
  console.log("one handle:", web._handle === bound._handle, "same port:", web.address().port === port);
  console.log(await get("/one"));

  const later = http.createServer((request, response) => response.end(`later ${request.url}`));
  await listening(later, { _handle: web._handle });
  console.log(await get("/two"));
  console.log("addresses:", [bound, web, later].map(address).join(", "));
  web.unref();
  web.ref();

  await closed(web);
  console.log("closed; listening:", [bound, web, later].map(server => server.listening).join(", "));
  console.log("addresses:", [bound, web, later].map(address).join(", "));

  for (const options of [{}, { host: "127.0.0.1" }, { handle: bound }, bound._handle]) {
    const server = http.createServer();
    try {
      server.listen(options);
      const [error] = await require("node:events").once(server, "error");
      console.log("error:", error.message);
    } catch (error) {
      console.log("throws:", error.code);
    }
  }
  await Promise.all([closed(bound), closed(later)]);
  console.log("all closed");
})();
