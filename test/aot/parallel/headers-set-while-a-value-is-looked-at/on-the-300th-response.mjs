import http from "node:http";
const make = () => new http.ServerResponse(new http.IncomingMessage(null));
const show = res => res.getHeaderNames().map(name => name + "=" + String(res.getHeader(name))).join(" ");
let lines = new Set();
for (let turn = 0; turn < 300; turn++) {
  const res = make();
  res.setHeader("X-Before", "b");
  const meddles = turn >= 200;
  let first = true;
  const odd = { toString() { if (first && meddles) { first = false; res.setHeader("X-Inner", "in"); } return "out"; } };
  res.setHeader("X-Outer", odd);
  lines.add((meddles ? "meddles: " : "quiet: ") + show(res));
}
console.log([...lines].join("\n"));
