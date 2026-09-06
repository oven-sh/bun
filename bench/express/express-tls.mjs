// Same hello world as express.mjs, served over HTTPS (see the README.md for how to generate cert.pem/key.pem)
import express from "express";
import fs from "fs";
import https from "https";

const app = express();
const port = Number(process.env.PORT || 3443);
const cert = fs.readFileSync(process.env.TLS_CERT || "cert.pem");
const key = fs.readFileSync(process.env.TLS_KEY || "key.pem");
let i = 0;

app.get("/", (req, res) => {
  res.send("Hello World! (request number: " + i++ + ")");
});

const server = https.createServer({ cert, key }, app);
server.listen(port, () => {
  console.log(`Express HTTPS server listening on port ${server.address().port}`);
});
