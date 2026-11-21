// Each of fourteen modules is first read in another form of expression, from a call and typeof to a class heritage, a pattern and a default parameter.
import { join } from "node:path";
import { EOL } from "node:os";
import { URL as URLOfModule } from "node:url";
import { EventEmitter } from "node:events";
import { stringify } from "node:querystring";
import { constants } from "node:zlib";
import { Readable } from "node:stream";
import fs from "node:fs";
import * as vm from "node:vm";
import { strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { lookup } from "node:dns";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
const said = [];
said.push(join("a", "b").length);
said.push(typeof EOL);
said.push(new URLOfModule("http://example.com/a").pathname);
class Emitter extends EventEmitter {}
said.push(typeof new Emitter().on);
said.push(Object.keys({ stringify }).join());
const { Z_OK, ...others } = constants;
said.push(Z_OK, typeof others);
said.push({} instanceof Readable);
said.push("readFileSync" in fs);
const key = "runInNewContext".slice(process.argv.length - process.argv.length);
said.push(typeof vm[key]);
said.push(String(strictEqual?.(1, 1)));
function kindOf(make = createHash) {
  return typeof make;
}
said.push(kindOf());
const later = () => lookup;
said.push(typeof later());
said.push(`${typeof readline?.createInterface}`);
said.push(process.argv.length > 99 ? "never" : typeof spawnSync);
console.log(said.join(" "));
