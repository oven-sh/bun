const http = require("node:http");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
process.on("uncaughtException", error => say("nobody catches", error.constructor.name, error.message.split(" (")[0]));
const server = http.createServer((request, response) => {
  say("a request arrives:", request.url, "| its table", Object.keys(request._events).join(","));
  response.end("made up");
});
const ask = async path => {
  try {
    const answer = await fetch("http://127.0.0.1:" + server.address().port + path, {
      signal: AbortSignal.timeout(2000),
    });
    say(path, "is answered", answer.status, await answer.text());
  } catch (error) {
    say(path, "fails", error.name);
  }
};
server.listen(0, "127.0.0.1", async () => {
  await ask("/before");
  await ask("/before-again");
  Object.defineProperty(http.IncomingMessage.prototype, "__proto__", {
    value: null,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  await ask("/behind");
  await ask("/behind-again");
  delete http.IncomingMessage.prototype.__proto__;
  await ask("/taken-away");
  console.log(said.join("\n"));
  server.close();
  process.exit(0);
});
