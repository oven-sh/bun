// node:path in a compiled program and in plain Bun: the same answers on ASCII paths of every kind, the same errors for values that are no strings, and what it hands out are ordinary objects and functions.
import path from "node:path";
import { basename, join, posix, win32 } from "node:path";

let seed = 2026;
const next = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;
const pieces = ["a", "bc", "def", ".", "..", "", "/", "//", "./", "../", "a/b", "/a", "b/", "...", ".a", "a.", "..a", "a..", " ", "a/./b", "a/../b", "../..", "/..", "/.", "x.y.z", "node_modules", "\\", "C:", ".ts", "index.ts"];
function make(): string {
  let made = next(3) === 0 ? "/" : "";
  for (let k = next(7); k > 0; k--) {
    made += pieces[next(pieces.length)];
    if (next(3) !== 0) made += "/";
  }
  return made;
}
let digest = 0;
function note(text: string) {
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
}
function outcome(f: Function, args: unknown[]): string {
  try {
    const result = f(...args);
    const text = typeof result === "object" && result !== null ? JSON.stringify(result) + Reflect.ownKeys(result).join() : typeof result + JSON.stringify(result);
    return text.replaceAll(process.cwd(), "<cwd>");
  } catch (error: any) {
    return `${error.name} ${error.code} ${error.code === undefined ? "" : error.message}`;
  }
}
const functions = ["resolve", "normalize", "isAbsolute", "join", "relative", "toNamespacedPath", "dirname", "basename", "extname", "parse"];
for (const flavor of [posix, win32] as any[]) {
  digest = 0;
  for (let round = 0; round < 3000; round++) {
    const p = make();
    const q = make();
    const r = make();
    for (const name of functions) {
      note(outcome(flavor[name], [p]));
      note(outcome(flavor[name], [p, q]));
      note(outcome(flavor[name], ["/" + p, q, r]));
    }
  }
  console.log(flavor.sep, "digest", digest);
}

const values: unknown[] = [undefined, null, 5, NaN, true, 1n, Symbol.iterator, {}, [], ["a"], new String("/a/b.c"), () => 1, { toString: () => "/x/y.z" }, ""];
for (const name of [...functions, "format", "matchesGlob"]) {
  console.log(name, outcome((posix as any)[name], []));
  for (const value of values) console.log(name, outcome((posix as any)[name], [value]), "|", outcome((posix as any)[name], ["/a/b.c", value]), "|", outcome((posix as any)[name], [value, "b.c"]));
}

for (const name of Reflect.ownKeys(posix) as string[]) {
  const value = (posix as any)[name];
  const descriptor = Object.getOwnPropertyDescriptor(posix, name)!;
  console.log(name, typeof value, typeof value === "function" ? "prototype" in value : typeof value === "string" ? value : "", descriptor.writable, descriptor.enumerable, descriptor.configurable);
}
console.log(path === posix, posix.posix === posix, posix.win32 === win32, win32.posix === posix, join === posix.join, basename === posix.basename, Object.getPrototypeOf(posix) === Object.prototype, Object.isExtensible(posix));

const parsed: any = posix.parse("/home/user/file.tar.gz");
console.log(JSON.stringify(parsed), Object.getPrototypeOf(parsed) === Object.prototype);
parsed.extra = 1;
delete parsed.root;
parsed.dir = 5;
Object.defineProperty(parsed, "base", { get: () => "got" });
console.log(JSON.stringify(parsed), Object.keys(parsed).join(), posix.format({ ...parsed, dir: "/d" }));

const patched: any = path;
const original = patched.join;
patched.join = (...parts: string[]) => "patched:" + parts.length;
console.log(path.join("a", "b"), join("a", "b"), posix.join("a", "b", "c"));
patched.join = original;
console.log(path.join("a", "b"));
patched.added = 7;
console.log(patched.added, delete patched.added, "added" in patched);
console.log(outcome(function () { return new patched.join("a"); }, []));
console.log(original.call(null, "a", "..", "b"), original.apply({ any: 1 }, ["/x", "y/"]), Reflect.apply(posix.dirname, undefined, ["/x/y"]));

const rope = "/" + "abc/".repeat(2000) + "name" + ".ext";
console.log(posix.normalize(rope).length, posix.dirname(rope).length, posix.basename(rope), posix.extname(rope), posix.relative(rope, rope + "/x"), posix.join(rope, "../../x").length, posix.resolve(rope, "..", "..").length);
console.log(posix.resolve() === process.cwd(), posix.resolve("") === process.cwd(), posix.resolve(".") === process.cwd(), posix.resolve("a") === process.cwd() + "/a", posix.relative("", "a"), posix.relative("a/b", ""));
console.log(posix.matchesGlob("/a/b.ts", "/a/*.ts"), posix.matchesGlob("/a/b.ts", "/a/*.js"), win32.matchesGlob("a\\b.ts", "a\\*.ts"), posix.matchesGlob("/a/b.ts", "/a/*.ts"));
