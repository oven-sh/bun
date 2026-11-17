// The same code, asked for three times on one connection. The table is written between the requests: a message that was looked at says nothing of the next one.
import http from "node:http";
import net from "node:net";
function talk(server, count, done) {
  const client = net.connect(server.address().port, "127.0.0.1");
  const heads = [];
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
  client.on("connect", ask);
  client.on("data", (bytes) => {
    const text = String(bytes);
    if (text.startsWith("HTTP/")) heads.push(text.slice(0, text.indexOf("\r\n")));
    if (!text.endsWith("ok")) return;
    if (++answers < count) return void setTimeout(ask, 5);
    setTimeout(() => { client.destroy(); server.close(); done(heads); }, 20);
  });
}
const log = [];
let requests = 0;
const server = http.createServer((req, res) => {
  if (++requests === 2) http.STATUS_CODES[299] = "two\nlines";
  if (requests === 3) http.STATUS_CODES[299] = "Two Lines";
  try { res.writeHead(299, { "Content-Length": 2 }); log.push("returned"); } catch (error) { log.push("threw " + error.code); res.statusMessage = "Mended"; res.setHeader("Content-Length", 2); }
  res.end("ok");
});
http.STATUS_CODES[299] = "One Line";
server.listen(0, () => talk(server, 3, (heads) => console.log(log.join(" | "), "/", heads.join(" | "))));
/* Output:
returned | threw ERR_INVALID_CHAR | returned / HTTP/1.1 299 One Line | HTTP/1.1 200 Mended | HTTP/1.1 299 Two Lines
*/
