// The same on a response of a server.
import http from "node:http";
http.STATUS_CODES[299] = "Odd\r\nX-Smuggled: 1";
const server = http.createServer((req, res) => {
  try {
    res.writeHead(299);
    console.log("writeHead() returned");
  } catch (error) {
    console.log("writeHead() threw", error.code);
  }
  console.log("headersSent", res.headersSent);
  req.socket.destroy();
});
server.listen(0, "127.0.0.1", async () => {
  await fetch(`http://127.0.0.1:${server.address().port}/`).catch(() => {});
  server.close();
});
/* Output:
writeHead() threw ERR_INVALID_CHAR
headersSent false
*/
