const http = require("node:http");
const server = http.createServer((req, res) => res.end("hello " + req.url));
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  http.get({ port, host: "127.0.0.1", path: "/a" }, res => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", c => (text += c));
    res.on("end", () => {
      console.log(text, res.req.agent === http.globalAgent, res.statusCode);
      fetch("http://127.0.0.1:" + port + "/b")
        .then(r => r.text())
        .then(t => {
          console.log(t);
          http.get({ port, host: "127.0.0.1", path: "/c", agent: new http.Agent({ keepAlive: false }) }, r => {
            r.resume();
            r.on("end", () => {
              console.log("third", r.statusCode, Object.keys(http.globalAgent.freeSockets).length > 0);
              http.globalAgent.destroy();
              server.close();
            });
          });
        });
    });
  });
});
