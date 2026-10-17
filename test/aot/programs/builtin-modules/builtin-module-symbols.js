// The symbols that the runtime's own modules keep in constants are names, wherever in the file the constant is declared: a message of node:http is filled and read without an access by a computed key.
import http from "node:http";
import { OutgoingMessage } from "node:http";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
let total = 0;
let last;
for (let i = 0; i < 50; i++) {
    last = new OutgoingMessage();
    last.setHeader("X-Number", String(i));
    last.setHeader("Content-Type", "text/plain");
    total += Number(last.getHeader("x-number")) + last.getHeaderNames().length + (last.hasHeader("content-type") ? 1 : 0) + last.writableHighWaterMark;
    last.removeHeader("content-type");
}
show("total", total);
show("headers", JSON.stringify(last.getHeaders()));
show("own symbols", Object.getOwnPropertySymbols(last).map(String).sort().join());
show("each is one of a kind", new Set(Object.getOwnPropertySymbols(last)).size === Object.getOwnPropertySymbols(last).length);
show("the same in every message", Object.getOwnPropertySymbols(last).every((symbol, index) => symbol === Object.getOwnPropertySymbols(new OutgoingMessage())[index]));
show("state", [last.writableCorked, last.writableLength, last.writableFinished, last.headersSent, last.socket, typeof http.ServerResponse].join());
last.cork();
last.cork();
show("corked", last.writableCorked);
console.log(lines.join("\n"));
