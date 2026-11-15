// A program stores another value under a member of node:stream in front of the first require("node:http"): the module loads and a server answers, as in plain.
const stream = require("node:stream");
stream.Readable = undefined;
try {
  const http = require("node:http");
  const server = http.createServer((req, res) => res.end("x"));
  server.listen(0, "127.0.0.1", async () => {
    const answer = await fetch("http://127.0.0.1:" + server.address().port + "/");
    console.log("loaded " + typeof http.createServer + " | answered " + answer.status + " " + (await answer.text()));
    server.close();
  });
} catch (error) {
  console.log("threw " + error.name);
}
