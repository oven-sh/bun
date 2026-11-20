// The raw headers of a message lie behind an accessor of the prototype. The constructor and the parser of a client store under the name: what they store goes to the setter, also to one of an heir.
import http from "node:http";

const bare = new http.IncomingMessage(null);
console.log("made by hand:", JSON.stringify(bare.rawHeaders), Object.hasOwn(bare, "rawHeaders"), "rawHeaders" in bare);
console.log("its own names:", Object.keys(bare).join(" "));
bare.rawHeaders = ["a", "1"];
console.log("behind a store:", JSON.stringify(bare.rawHeaders), Object.hasOwn(bare, "rawHeaders"), JSON.stringify(bare.headers));

const stores = [];
class Heir extends http.IncomingMessage {
  get rawHeaders() {
    return super.rawHeaders;
  }
  set rawHeaders(value) {
    stores.push(JSON.stringify(value));
    super.rawHeaders = value;
  }
}
const heir = new Heir(null);
console.log("an heir's setter saw:", stores.join(" | "), "| reads", JSON.stringify(heir.rawHeaders));
heir._addHeaderLines(["x-one", "1", "x-two", "2"], 4);
console.log("behind the lines of a head:", stores.join(" | "), "| reads", JSON.stringify(heir.rawHeaders), JSON.stringify(heir.headers));
heir.complete = true;
heir._addHeaderLines(["x-last", "3"], 2);
console.log("behind the lines of a tail:", stores.join(" | "), "| trailers", JSON.stringify(heir.rawTrailers), JSON.stringify(heir.trailers));

const server = http.createServer((req, res) => {
  console.log("at the server:", JSON.stringify(req.rawHeaders.filter((_, index, list) => /^x-/i.test(list[index - (index % 2)]))), Object.hasOwn(req, "rawHeaders"));
  res.writeHead(200, { "X-Answer": "yes", "x-again": ["1", "2"] });
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  http.get({ port: server.address().port, host: "127.0.0.1", headers: { "X-Asked": "a", "x-more": "b" }, agent: false }, res => {
    const raw = res.rawHeaders;
    const shown = raw.filter((_, index) => /^x-/i.test(raw[index - (index % 2)]));
    console.log("at the client:", JSON.stringify(shown), Object.hasOwn(res, "rawHeaders"), res.headers["x-answer"], res.headers["x-again"]);
    res.resume();
    res.on("end", () => server.close());
  });
});
