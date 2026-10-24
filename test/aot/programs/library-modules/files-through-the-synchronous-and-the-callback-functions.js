// node:fs without promises: the Sync functions, the callback forms, read and write streams, a descriptor, and errors that are thrown or handed to the callback.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "library-modules-"));
const at = name => path.join(folder, name);
fs.writeFileSync(at("a.txt"), "alpha beta gamma");
console.log(fs.existsSync(at("a.txt")), fs.existsSync(at("b.txt")), fs.readFileSync(at("a.txt"), "utf8"), fs.statSync(at("a.txt")).size);
const descriptor = fs.openSync(at("a.txt"), "r");
const buffer = Buffer.alloc(4);
fs.readSync(descriptor, buffer, 0, 4, 6);
fs.closeSync(descriptor);
console.log(buffer.toString());
try {
  fs.readFileSync(at("missing"));
} catch (error) {
  console.log(error.code, error.syscall, error instanceof Error);
}
console.log(fs.statSync(at("missing"), { throwIfNoEntry: false }));
console.log(await new Promise(resolve => fs.readFile(at("a.txt"), "utf8", (error, text) => resolve([error, text.length].join()))));
console.log(await new Promise(resolve => fs.readFile(at("missing"), error => resolve(error.code))));
await new Promise((resolve, reject) => {
  const out = fs.createWriteStream(at("copy.txt"));
  fs.createReadStream(at("a.txt"), { start: 6, end: 9, encoding: "utf8" }).on("error", reject).pipe(out);
  out.on("finish", resolve);
});
console.log(fs.readFileSync(at("copy.txt"), "utf8"));
let pieces = 0;
for await (const piece of fs.createReadStream(at("a.txt"), { highWaterMark: 5 })) pieces += piece.length > 0 ? 1 : 0;
console.log(pieces);
fs.mkdirSync(at("x/y"), { recursive: true });
fs.renameSync(at("copy.txt"), at("x/y/moved.txt"));
console.log(fs.readdirSync(folder).sort().join(), fs.readdirSync(at("x/y")).join());
const directory = fs.opendirSync(folder);
const names = [];
for (let entry; (entry = directory.readSync()); ) names.push(entry.name);
directory.closeSync();
console.log(names.sort().join());
fs.rmSync(folder, { recursive: true, force: true });
console.log(fs.existsSync(folder), typeof fs.constants.O_RDONLY, fs.constants.F_OK);
