// An https agent names the pool of a request by its options, the list of CA certificates among them: 150 strings, 280 KB in all, joined for every request.
// 300 names are kept. A join of long strings is a rope, so a name costs a few KB. Measured: 2.9 MB; 85 MB where the join was the engine's own flat copy; 87 MB in plain Bun.
import https from "node:https";
const before = process.memoryUsage().rss;
const ca = [];
for (let i = 0; i < 150; i++) ca.push("-----BEGIN CERTIFICATE-----\n" + String(i).repeat(800) + "\n-----END CERTIFICATE-----");
const agent = new https.Agent({ keepAlive: true });
const names = [];
let length = 0;
for (let i = 0; i < 300; i++) {
  const name = agent.getName({ host: "example.com", port: 443 + i, ca });
  length += name.length;
  names.push(name);
}
const grown = process.memoryUsage().rss - before;
console.log(length, names.length, names[7].slice(0, 20), names[7].indexOf("-----END"));
console.log("grew by less than 30 MB:", grown < 30 * 1024 * 1024);
