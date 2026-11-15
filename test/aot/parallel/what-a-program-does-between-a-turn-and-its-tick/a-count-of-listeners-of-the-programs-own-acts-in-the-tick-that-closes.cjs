// The tick that closes a request calls listenerCount("error"), and reads the request's two states behind that call. A listenerCount of the program's own acts there.
const http = require("node:http");

const deeds = {
  "lays a writable side"(req, side) {
    req._writableState = side;
  },
  "takes the state away"(req) {
    req._readableState = undefined;
  },
  "answers with an object"() {},
};

function run(label) {
  return new Promise(resolve => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const side = {};
      req.listenerCount = function (name) {
        if (name !== "error") return 0;
        deeds[label](this, side);
        if (label !== "answers with an object") return 0;
        return {
          valueOf() {
            seen.push("valueOf");
            return 0;
          },
        };
      };
      req.on("close", () => seen.push("close " + Object.getOwnPropertySymbols(side).length));
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      let answers = 0;
      for (let turn = 0; turn < 6; turn++) answers += (await (await fetch(`http://127.0.0.1:${port}/`)).text()).length;
      setTimeout(() => {
        server.close();
        server.closeAllConnections();
        resolve(`answers ${answers} | ${seen.join(" ")}`);
      }, 50);
    });
  });
}

let uncaught = [];
process.on("uncaughtException", error => uncaught.push(error.constructor.name));
(async () => {
  for (const label of Object.keys(deeds)) {
    uncaught = [];
    const row = await run(label);
    console.log(label, ":", row, "| uncaught", [...new Set(uncaught)].join());
  }
  process.exit(0);
})();
