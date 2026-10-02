// One session, then exit. usage: <runtime> server-one.cjs [limit]
const http2 = require("node:http2");
const LIMIT = process.argv[2] ? Number(process.argv[2]) : undefined;
const server = http2.createServer(LIMIT === undefined ? {} : { settings: { maxConcurrentStreams: LIMIT } });
server.on("session", session => {
  session.on("error", () => {});
  session.on("close", () => process.exit(0));
});
server.on("stream", stream => {
  stream.on("error", () => {});
  stream.respond({ ":status": 200 });
  stream.end("ok");
});
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ port: server.address().port })));
