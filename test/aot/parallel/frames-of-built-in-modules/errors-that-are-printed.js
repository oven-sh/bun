// Under: --sourcemap=external: an error that is printed shows the frames of a built-in module
// Under: --obfuscate: the same
const http = require("node:http");
const { EventEmitter } = require("node:events");

const framesOfBuiltIns = text =>
  text
    .split("\n")
    .map(line => line.trim().replace(/:\d+:\d+\)$/, ")"))
    .filter(line => /^at .*\(node:\w+\)$/.test(line));

const emitter = new EventEmitter();
emitter.on("error-of-a-listener", () => {
  throw new Error("thrown by a listener");
});
try {
  emitter.emit("error-of-a-listener");
} catch (error) {
  console.log(framesOfBuiltIns(Bun.inspect(error)));
}
const agent = new http.Agent();
agent.createConnection = () => {
  throw new Error("no connection");
};
try {
  http.request({ host: "127.0.0.1", port: 1, agent });
} catch (error) {
  console.log(framesOfBuiltIns(error.stack));
  console.log(framesOfBuiltIns(Bun.inspect(error)));
}
