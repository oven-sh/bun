// Each of six modules is first read in code that native code calls or that runs while an error unwinds: a comparator, a toJSON(), a replacer, a Proxy trap, a getter and a finally block.
import { basename } from "node:path";
import { EOL } from "node:os";
import { format } from "node:url";
import { escape } from "node:querystring";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
const said = [];
said.push(["/x/b", "/y/a"].sort((one, other) => (basename(one) < basename(other) ? -1 : 1)).join());
said.push(JSON.stringify({ toJSON: () => typeof EOL }));
said.push("a-b".replace("-", () => format({ protocol: "http", host: "example.com" }).length));
said.push(new Proxy({}, { get: (target, key) => escape(String(key) + " ") }).made);
said.push(
  Object.entries({
    get kind() {
      return typeof zlib.gzipSync;
    },
  }).join(),
);
try {
  try {
    throw new Error("made up");
  } finally {
    said.push(typeof new EventEmitter().emit);
  }
} catch (error) {
  said.push(error.message);
}
console.log(said.join(" "));
