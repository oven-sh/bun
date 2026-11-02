// A response made by hand and an outgoing message get a header and are then frozen, sealed or closed to new properties, by a call that is written out and by a function that is handed around.
// Under the symbol that node:_http_outgoing exports they show the map of their headers.
const http = require("node:http"),
  net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");
const show = value => JSON.stringify(value) ?? "undefined";
for (const [name, close] of [
  ["freeze", Object.freeze],
  ["seal", Object.seal],
  ["preventExtensions", Object.preventExtensions],
]) {
  const res = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  res.setHeader("X-One", "1");
  close(res);
  console.log(
    name,
    show(Object.getOwnPropertyDescriptor(res, kOutHeaders)),
    show(res[kOutHeaders]),
    show(res.getHeaders()),
  );
}
{
  const res = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  res.setHeader("X-One", "1");
  Object.freeze(res);
  console.log(
    "written out",
    show(Object.getOwnPropertyDescriptor(res, kOutHeaders)),
    show(res[kOutHeaders]),
    show(res.getHeaders()),
  );
}
{
  const res = new http.OutgoingMessage();
  res.setHeader("X-One", "1");
  Object.freeze(res);
  console.log(
    "an outgoing message",
    show(Object.getOwnPropertyDescriptor(res, kOutHeaders)),
    show(res[kOutHeaders]),
    show(res.getHeaders()),
  );
}
