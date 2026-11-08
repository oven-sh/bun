// The message that the program wrote into the table holds a line break and a header: writeHead(code) refuses it, on a response that no server made.
import http from "node:http";
http.STATUS_CODES[299] = "Odd\r\nX-Injected: yes";
const res = new http.ServerResponse(new http.IncomingMessage(null));
try {
  res.writeHead(299);
  console.log("taken", res._header.includes("\r\nX-Injected: yes\r\n"));
} catch (error) {
  console.log(error.code);
}
/* Output:
ERR_INVALID_CHAR
*/
