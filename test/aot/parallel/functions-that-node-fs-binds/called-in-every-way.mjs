// The four functions that node:net calls: what they take, what they answer, and what they do with a receiver.
import fs, { appendFileSync, chmodSync, closeSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const folder = fs.mkdtempSync(join(tmpdir(), "functions-that-node-fs-binds-")), file = join(folder, "text.txt");
function ask(test) {
  try { return test(); } catch (error) { return `${error.name} ${error.code} ${error.syscall} ${error.message}`.replaceAll(folder, "<folder>"); }
}
console.log(appendFileSync(file, "one "), appendFileSync.call({ other: 1 }, file, Buffer.from("two ")), appendFileSync.apply(7, [file, new Uint8Array([51]), { mode: 0o600 }]));
console.log(fs.appendFileSync(pathToFileURL(file), " four", "latin1"), Reflect.apply(fs.appendFileSync, undefined, [Buffer.from(file), new DataView(new Uint8Array([33]).buffer)]));
console.log(fs.readFileSync(file, "utf8"), ask(() => appendFileSync(file)), ask(() => appendFileSync()), ask(() => appendFileSync(file, {})), ask(() => appendFileSync(folder, "x")), ask(() => appendFileSync(file, "x", "none")));
console.log(chmodSync(file, 0o640), (fs.statSync(file).mode & 0o777).toString(8), chmodSync(file, "600"), (fs.statSync(file).mode & 0o777).toString(8), ask(() => chmodSync(file)), ask(() => chmodSync(join(folder, "none"), 0o600)), ask(() => chmodSync(file, -1)));
const fd = fs.openSync(file, "r");
const stats = fstatSync(fd), big = fstatSync(fd, { bigint: true });
console.log(stats.constructor.name, stats.size, stats.isFile(), big.constructor.name, big.size, fstatSync(fd, undefined).size, fstatSync(fd, {}).size, fstatSync(fd, { bigint: false }).size, fstatSync.call(null, fd).size);
console.log(appendFileSync(fs.openSync(file, "a"), "!"), fs.fstatSync(fd).size, ask(() => fstatSync("no")), ask(() => fstatSync(-1)), ask(() => fstatSync()));
console.log(closeSync(fd), ask(() => closeSync(-1)), ask(() => fstatSync(fd)), ask(() => closeSync()), ask(() => closeSync("no")), ask(() => closeSync.call({}, 1.5)));
let asked = [];
const options = { get mode() { asked.push("mode"); return 0o600; }, get flag() { asked.push("flag"); return "a"; }, get encoding() { asked.push("encoding"); return "utf8"; }, get bigint() { asked.push("bigint"); return true; } };
appendFileSync(file, "", options);
const again = fs.openSync(file, "r");
console.log(typeof fstatSync(again, options).size, asked.join(), closeSync(again, "more", "and more"));
let total = 0;
for (let i = 0; i < 300; i++) {
  const descriptor = fs.openSync(file, i % 3 ? "r" : "a");
  total += fstatSync(descriptor).size;
  if (i % 3 === 0) appendFileSync(descriptor, "x");
  closeSync(descriptor);
}
console.log(total, fs.statSync(file).size);
const { readFileSync } = fs, replaced = [];
fs.closeSync = function (...operands) { replaced.push(this === fs, operands.length); return closeSync.apply(this, operands); };
console.log(fs.closeSync(fs.openSync(file, "r")), replaced.join(), closeSync === fs.closeSync, readFileSync(file).length);
fs.rmSync(folder, { recursive: true });
