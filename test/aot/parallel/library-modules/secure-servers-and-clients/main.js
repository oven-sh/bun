// node:tls and node:https with the certificate of Bun's own tests (certificate.json): a TLS server that echoes, a client that trusts the certificate and one that does not, what both sides say about the connection, an HTTPS server with https.request, https.get, fetch and an agent, and the certificate read by crypto.X509Certificate.
import tls from "node:tls";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import certificate from "./certificate.json";

const server = tls.createServer({ cert: certificate.cert, key: certificate.key }, socket => {
  socket.write("welcome " + socket.encrypted + " " + socket.authorized + "\n");
  socket.on("data", part => socket.end("echo " + part));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();

const client = tls.connect({ port, host: "127.0.0.1", ca: certificate.cert, servername: "localhost" });
await once(client, "secureConnect");
console.log(client.authorized, client.authorizationError, client.encrypted, /^TLSv1\.[23]$/.test(client.getProtocol()), typeof client.getCipher().name, client.getPeerCertificate().subject.CN, client.servername);
let text = "";
client.setEncoding("utf8").on("data", part => (text += part));
client.write("hello");
await once(client, "close");
console.log(JSON.stringify(text));

console.log((await once(tls.connect({ port, host: "127.0.0.1", servername: "localhost" }), "error"))[0].code);
const careless = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
await once(careless, "secureConnect");
console.log(careless.authorized, careless.authorizationError);
careless.destroy();
await new Promise(resolve => server.close(resolve));

const web = https.createServer({ cert: certificate.cert, key: certificate.key }, (request, response) => {
  response.setHeader("x-secure", String(request.socket.encrypted));
  response.end(request.method + " " + request.url);
});
web.listen(0, "127.0.0.1");
await once(web, "listening");
const options = { host: "127.0.0.1", port: web.address().port, ca: certificate.cert, servername: "localhost" };
function read(response) {
  return new Promise(resolve => { let body = ""; response.on("data", part => (body += part)).on("end", () => resolve([response.statusCode, response.headers["x-secure"], body].join(" "))); });
}
console.log(await new Promise((resolve, reject) => https.get({ ...options, path: "/get" }, response => resolve(read(response))).on("error", reject)));
console.log(await new Promise((resolve, reject) => https.request({ ...options, path: "/post", method: "POST", agent: new https.Agent({ keepAlive: false }) }, response => resolve(read(response))).on("error", reject).end("body")));
console.log(await new Promise(resolve => https.get({ ...options, ca: undefined }, () => resolve("trusted")).on("error", error => resolve(error.code))));
console.log(await (await fetch("https://localhost:" + options.port + "/fetch", { tls: { ca: certificate.cert } })).text());
console.log(await fetch("https://localhost:" + options.port + "/fetch").catch(error => error.code));
web.closeAllConnections();
await new Promise(resolve => web.close(resolve));

const parsed = new X509Certificate(certificate.cert);
console.log(parsed.subject.split("\n").at(-1), parsed.ca, parsed.checkHost("localhost"), parsed.checkHost("example.com"), parsed.checkIP("127.0.0.1"), parsed.validTo.slice(-8), parsed.fingerprint256.length, parsed.publicKey.asymmetricKeyType, parsed.verify(parsed.publicKey));
