// node:http2 secure server with allowHTTP1, so the same port answers h2 and
// HTTP/1.1 like Bun.serve({ http2: true }) does.
import { readFileSync } from "node:fs";
import { createSecureServer } from "node:http2";

const here = new URL(".", import.meta.url).pathname;
const body = Buffer.alloc(Number(process.env.BODY_SIZE ?? 13), "x");

const server = createSecureServer(
  { cert: readFileSync(here + "../grpc-server/cert.pem"), key: readFileSync(here + "../grpc-server/key.pem"), allowHTTP1: true },
  (req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "content-length": body.length });
    res.end(body);
  },
);
server.listen(Number(process.env.PORT ?? 0), () => {
  console.log("READY " + server.address().port);
});
