import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import files, { existsSync, lstatSync, readFileSync, readdirSync, readFileSync as read, statSync } from "node:fs";
import * as fs from "fs";
import { tmpdir } from "node:os";
import path, { basename, dirname, join } from "node:path";
import * as paths from "path";

const folder = mkdtempSync(join(tmpdir(), "node-module-results-"));
const file = join(folder, "text.txt");
writeFileSync(file, "one,two\nthree,fo\u00fcr\n\u{1f600}");

function lengthOf(text: string): number {
  let length = 0;
  for (const line of text.split("\n")) for (const cell of line.split(",")) length += cell.length;
  return length;
}
console.log(lengthOf(readFileSync(file, "utf8")), lengthOf(read(file, "utf-8")), lengthOf(fs.readFileSync(file, "utf8")), lengthOf(files.readFileSync(file, "utf8")));
for (const encoding of ["utf8", "UTF8", "latin1", "hex", "base64", "base64url", "ascii", "binary", "ucs2", "utf16le", "buffer", ""] as const) {
  const read = files.readFileSync(file, encoding as "utf8") as unknown;
  console.log(encoding, typeof read, read instanceof Buffer, (read as string).length);
}
console.log(readFileSync(file).constructor.name, readFileSync(file, {}).constructor.name, typeof readFileSync(file, { encoding: "utf8" }), typeof readFileSync(file, "hex"), readFileSync(file, undefined).constructor.name, readFileSync(file, null).constructor.name);
for (const options of ["utf9", 5, Symbol.iterator, { encoding: "none" }, true]) {
  try {
    console.log(typeof readFileSync(file, options as any));
  } catch (error: any) {
    console.log(error.constructor.name, error.code ?? error.message);
  }
}
try {
  readFileSync(join(folder, "absent"), "utf8");
} catch (error: any) {
  console.log(error.code, error.syscall, basename(error.path));
}
console.log(existsSync(file), existsSync(join(folder, "absent")), (existsSync as any)(), files.existsSync(5 as any), fs.existsSync(folder));
console.log(statSync(file).size, lstatSync(file).isFile(), statSync(folder).isDirectory(), statSync(join(folder, "absent"), { throwIfNoEntry: false }), typeof statSync(file, { bigint: true }).size);
console.log(readdirSync(folder).join(), readdirSync(folder, { withFileTypes: true })[0].name, readdirSync(folder, "buffer")[0].constructor.name);
for (const f of [readFileSync, existsSync, statSync, lstatSync, readdirSync] as Function[]) console.log(f.name, f.length, "prototype" in f, Object.getOwnPropertyNames(f).join());
console.log(join("a", "b"), path.join("a", "..", "c"), paths.join("/", "d"), dirname("/a/b"), path.basename("/a/b.c", ".c"), paths.extname("e.f"), path.resolve("/a", "b"), path.relative("/a/b", "/a/c"), path.isAbsolute("x"), path.normalize("a//b/../c"), path.sep, path.posix.join("g", "h"), path.win32.join("i", "j"), path.win32.resolve("C:\\a", "b"), path.parse("/a/b.c").ext, path.format({ dir: "/a", base: "b" }), path.matchesGlob("a/b", "a/*"));
for (const operand of [5, undefined, null, {}, new String("boxed")]) {
  try {
    console.log(join(operand as any, "x"), basename(operand as any));
  } catch (error: any) {
    console.log(error.code, error.message);
  }
}
let joined = "";
for (let i = 0; i < 1000; i++) joined = join(joined, i % 7 ? ".." : "part" + i);
console.log(joined, joined.length);
rmSync(folder, { recursive: true });
