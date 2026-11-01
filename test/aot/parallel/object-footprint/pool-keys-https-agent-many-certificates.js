// An https agent names the pool of a request by its options, the list of CA certificates among them: 150 strings, 280 KB in all, joined for every request.
// 300 names are kept. A join of long strings is a rope, so a name costs a few KB. Kept after a collection, by the collector's own count: 1.6 MB; 80.4 MB where the join is a flat copy, as in plain Bun.
import https from "node:https";
Bun.gc(true);
const usedBefore = process.memoryUsage().heapUsed;
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
console.log(length, names.length, names[7].slice(0, 20), names[7].indexOf("-----END"));
Bun.gc(true);
const kept = process.memoryUsage().heapUsed - usedBefore;
console.log("what is kept takes less than 30 MB of the heap:", kept < 30 * 1024 * 1024);
console.log(names.length);
/* Output:
84085500 300 example.com:450::--- 846
what is kept takes less than 30 MB of the heap: true
300
*/
