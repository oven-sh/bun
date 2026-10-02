// K sequential GET requests on one http2.connect() session. usage: <runtime> client-seq.cjs <port> <K>
const http2 = require("node:http2");
const port = Number(process.argv[2]);
const K = Number(process.argv[3] || 6);
const client = http2.connect("http://127.0.0.1:" + port);
client.on("error", e => { console.log("client error", e.code); process.exit(1); });
(async () => {
  for (let i = 0; i < K; i++) {
    await new Promise((resolve, reject) => {
      const req = client.request({ ":path": "/" });
      req.on("error", reject);
      req.resume();
      req.on("close", resolve);
      req.end();
    });
  }
  client.close(() => process.exit(0));
})();
