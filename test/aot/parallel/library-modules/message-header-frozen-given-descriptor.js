// A response made by hand gets a header and is then frozen, or the map of its headers is given other attributes, by a call that is written out. A second header follows, and the response shows both.
// Flags: --aot-validate
const http = require("node:http"),
  net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");
const show = value => JSON.stringify(value) ?? "undefined";
{
  const res = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  res.setHeader("X-One", "1");
  Object.freeze(res);
  res.setHeader("X-Two", "2");
  console.log("frozen", show(res[kOutHeaders]), show(res.getHeaders()), res.hasHeader("x-two"), res.getHeaderNames().join());
}
{
  const res = new http.ServerResponse(new http.IncomingMessage(new net.Socket()));
  res.setHeader("X-One", "1");
  const isDefined = Reflect.defineProperty(res, kOutHeaders, { enumerable: false });
  res.setHeader("X-Two", "2");
  console.log("defined", isDefined, show(Object.getOwnPropertyDescriptor(res, kOutHeaders)), show(res.getHeaders()), res.hasHeader("x-two"), res.getHeaderNames().join());
}
{
  const res = new http.OutgoingMessage();
  res.setHeader("X-One", "1");
  Object.freeze(res);
  res.setHeader("X-Two", "2");
  console.log("an outgoing message", show(res[kOutHeaders]), show(res.getHeaders()), res.hasHeader("x-two"), res.getHeaderNames().join());
}
