import http from "node:http";
const store = Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "headers").set;
const show = res => res.getHeaderNames().map(name => name + "=" + String(res.getHeader(name))).join(" ");
for (const nothing of [null, undefined]) {
  const res = new http.ServerResponse(new http.IncomingMessage(null));
  res.setHeader("X-Old", "old");
  store.call(res, nothing);
  console.log("[" + show(res) + "]", res.hasHeader("x-old"), String(res.getHeader("x-old")));
  res.setHeader("X-Late", "late");
  console.log(show(res));
}
