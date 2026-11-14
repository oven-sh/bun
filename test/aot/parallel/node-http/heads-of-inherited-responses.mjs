// COUNTER: operationAOTGetByIdAndCache <= 400
// A response of a class below ServerResponse writes its head: the names that node:_http_server keeps for itself are read off it, and what a read found is remembered.
import http from "node:http";
import util from "node:util";
function Response(req) {
  http.ServerResponse.call(this, req);
  this.kept = { headers: null, chunks: [] };
  this.setHeader("x-first", "1");
  this.removeHeader("x-first");
}
util.inherits(Response, http.ServerResponse);
Response.prototype.writeHead = function () {
  const result = http.ServerResponse.prototype.writeHead.apply(this, arguments);
  this.kept.headers = Object.assign({}, this.getHeaders());
  return result;
};
class Below extends http.ServerResponse {
  constructor(req) {
    super(req);
    this.own = 1;
  }
}
const req = { method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} };
const seen = [];
for (let i = 0; i < 1000; i++) {
  const response = new (i % 2 ? Response : Below)(req);
  response.writeHead(200 + (i % 3), { "x-count": String(i) });
  if (i % 250 < 2) seen.push(response.statusCode, response.headersSent, response.getHeader("x-count"), JSON.stringify(response.kept ?? null), response.own ?? "none");
}
console.log(seen.join(" "));
const names = Object.getOwnPropertySymbols(new Below(req)).map(String);
const last = new Below(req);
const before = Object.getOwnPropertySymbols(last).length;
last.writeHead(204);
const added = Object.getOwnPropertySymbols(last).filter(name => !names.includes(String(name)));
console.log(added.length > 0, added.every(name => last[name] !== undefined || name in last), before <= Object.getOwnPropertySymbols(last).length);
for (const name of added) {
  const value = last[name];
  last[name] = value;
  console.log(last[name] === value, Reflect.get(last, name) === value, name in last, name in new Below(req));
  break;
}
try {
  last.writeHead(200);
} catch (error) {
  console.log(error.code);
}
