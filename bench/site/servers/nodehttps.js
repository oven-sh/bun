const https = require("https");
const fs = require("fs");
const server = https.createServer(
  { cert: fs.readFileSync(process.env.TLS_CERT || "cert.pem"), key: fs.readFileSync(process.env.TLS_KEY || "key.pem") },
  (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.end("Hello World!");
  },
);
server.listen(0, () => console.log(`node:https listening on port ${server.address().port}`));
