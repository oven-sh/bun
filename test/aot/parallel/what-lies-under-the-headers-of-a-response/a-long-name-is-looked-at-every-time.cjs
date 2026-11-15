// A header's name is matched against a pattern where it has not been looked at before, and RegExp.lastMatch shows the match. A name of over 64 characters is remembered by nobody.
const http = require("node:http");

const rows = [];
const server = http.createServer((req, res) => {
  for (const length of [10, 64, 65, 70]) {
    const name = "x-" + "a".repeat(length - 2);
    const seen = [];
    for (let turn = 0; turn < 4; turn++) {
      "q".match(/q/);
      res.setHeader(name, String(turn));
      seen.push(RegExp.lastMatch.length);
    }
    rows.push(`${length}: ${seen.join()} . ${res.getHeader(name)}`);
  }
  res.end("ok");
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (let turn = 0; turn < 2; turn++) {
    const answer = await fetch(`http://127.0.0.1:${port}/`);
    await answer.text();
    rows.push("sent " + [...answer.headers.keys()].filter(name => name.startsWith("x-")).map(name => name.length).join());
  }
  console.log(rows.join("\n"));
  server.closeAllConnections();
  server.close();
});
