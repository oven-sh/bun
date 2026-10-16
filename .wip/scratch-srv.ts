import { appendFileSync, writeFileSync } from "node:fs";
import { prefixRegistry } from "./prefix-registry";

const registry = prefixRegistry({ cli: (prefix, version) => `console.log("SERVED-BY-${prefix}@${version}");` });
writeFileSync("/tmp/probe/port", String(registry.port));
writeFileSync("/tmp/probe/requests.log", "");
let seen = 0;
setInterval(() => {
  while (seen < registry.requests.length) {
    const r = registry.requests[seen++];
    appendFileSync("/tmp/probe/requests.log", `${r.prefix} ${r.authorization}\n`);
  }
}, 50);
process.on("SIGUSR1", () => registry.publish("2.0.0"));
console.log("listening", registry.port);
