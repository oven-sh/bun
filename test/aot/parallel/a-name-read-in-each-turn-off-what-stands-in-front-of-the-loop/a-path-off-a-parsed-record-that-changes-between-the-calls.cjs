// STATISTIC: ReadsByNameThatAskTheirSitesAlone >= 6
"use strict";
const raw = JSON.parse('{"server":{"port":8080,"limits":{"body":100}},"ttl":60,"size":4}');
function sum(t) { let s = 0; for (let i = 0; i < 40; i++) s += raw.server.port + raw.server.limits.body + raw.ttl + raw.size + t; return s; }
for (let t = 0; t < 2000; t++) sum(t);
console.log(sum(1), sum(2));
raw.server.port = 1;
console.log(sum(1));
raw.server = { port: 2, limits: { body: 3 } };
console.log(sum(1));
delete raw.ttl;
console.log(sum(1));
raw.ttl = 1; raw.size = "4";
console.log(sum(1).length);
