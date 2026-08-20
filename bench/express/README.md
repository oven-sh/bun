# express benchmark

This benchmarks a hello world express server.

To install dependencies:

```bash
bun install
```

To run in Bun:

```sh
bun ./express.mjs
```

To run in Node:

```sh
node ./express.mjs
```

To run in Deno:

```sh
deno run -A ./express.mjs
```

To run the same server over HTTPS (`express-tls.mjs`), generate a self-signed certificate first:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
bun ./express-tls.mjs   # or node / deno run -A; TLS_CERT / TLS_KEY override the file paths
```

To benchmark each runtime:

```bash
oha http://localhost:3000 -n 500000 -H "Accept-Encoding: identity"
bombardier -k -c 50 -d 5s -l -H "Accept-Encoding: identity" https://localhost:3443
```

We recommend using `oha` or `bombardier` for benchmarking. We do not recommend using `ab`, as it uses HTTP/1.0 which stopped being used by web browsers in the early 2000s. We also do not recommend using autocannon, as the node:http client is not performant enough to measure the throughput of Bun's HTTP server.

Note the `Accept-Encoding: identity` header exists to prevent Deno's HTTP server from compressing the response.
