// Only a function made from a string loads the file from disk. That file uses built-in modules that nothing here names.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "evaluated-text-loads-"));
const file = path.join(folder, "late.mjs");
fs.writeFileSync(
  file,
  `
import assert from "node:assert";
import { createHash } from "node:crypto";
import http from "node:http";
import * as inspector from "node:inspector";
import util from "node:util";
export default async function (say) {
  say(createHash("sha1").update("a").digest("hex").slice(0, 8));
  say(util.inspect({ a: [1, new Map([["k", 2]])] }), util.format("%s %d", "x", 3));
  try { assert.deepStrictEqual({ a: 1 }, { a: 2 }); } catch (error) { say(error.code); }
  say(typeof inspector.Session, http.METHODS.includes("GET"));
  const server = http.createServer((request, response) => response.end("served " + request.url)).listen(0);
  await new Promise(done => server.once("listening", done));
  say(await (await fetch("http://localhost:" + server.address().port + "/x")).text());
  server.close();
}
`,
);
const load = new Function("path", "return import(path)");
load(file)
  .then(late => late.default((...words) => console.log(...words)))
  .finally(() => fs.rmSync(folder, { recursive: true }));
/* Output:
86f7e437
{ a: [ 1, Map(1) { 'k' => 2 } ] } x 3
ERR_ASSERTION
function true
served /x
*/
