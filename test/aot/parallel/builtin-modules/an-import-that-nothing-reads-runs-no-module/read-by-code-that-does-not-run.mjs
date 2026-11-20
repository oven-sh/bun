// The names are read in a function that nobody calls and behind a test that fails: no module of Bun runs.
// COUNT: operation:operationAOTRequireModule = 0
import os, { EOL } from "node:os";
import { runInNewContext } from "node:vm";
import * as url from "node:url";
import { setTimeout as later } from "node:timers";
import dns from "node:dns";
import querystring from "node:querystring";
function neverCalled() {
  later(() => {}, 1);
  for (let i = 0; i < 3; i++) if (url.fileURLToPath(import.meta.url).endsWith(EOL)) return i;
  return [os.constants, url.parse, dns.lookup, querystring.parse, runInNewContext("1")];
}
const never = process.argv.length > 100;
if (never) console.log(neverCalled(), querystring.stringify({ a: 1 }), EOL, runInNewContext);
console.log(never ? dns.resolve : "nothing read", typeof neverCalled);
