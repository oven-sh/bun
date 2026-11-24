// The same store behind node:http's first load, and behind a server's listen(): which class makes the requests of a server made in front of it, and of one made behind it.
const http = require("node:http");
const incoming = require("node:_http_incoming");
const Original = incoming.IncomingMessage;
class Asked extends Original {}
const answer = (req, res) => res.end([req instanceof Asked, req instanceof Original, req.constructor.name, req.url].join(" "));
const first = http.createServer(answer);
first.listen(0, async () => {
  const ask = async (server, path) => console.log(await (await fetch("http://127.0.0.1:" + server.address().port + path)).text());
  await ask(first, "/in-front");
  incoming.IncomingMessage = Asked;
  await ask(first, "/behind-on-the-first");
  const second = http.createServer(answer);
  await new Promise(done => second.listen(0, done));
  await ask(second, "/on-the-second");
  const third = http.createServer({ IncomingMessage: Asked }, answer);
  await new Promise(done => third.listen(0, done));
  await ask(third, "/by-the-option");
  first.close(); second.close(); third.close();
});
