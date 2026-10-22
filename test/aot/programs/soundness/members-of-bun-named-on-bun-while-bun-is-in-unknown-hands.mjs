// Bun goes into hands that nobody follows, its names are listed, and text is evaluated. None of that uses a member of Bun. Each member that the program names on Bun is there, whichever way the program came to Bun.
import defaultExport, { peek as importedPeek } from "bun";
import * as namespace from "bun";
const unknown = value => new CustomEvent("x", { detail: value }).detail;
console.log(Object.keys(unknown(Bun)).length > 50, new Function("return 1")());
const attempt = (way, action) => {
  try {
    console.log(way + ":", action());
  } catch (error) {
    console.log(way + ": threw", error.message);
  }
};
const local = Bun;
const dynamic = await import("bun");
const awaited = await Promise.resolve(Bun);
const through = bun => bun.stringWidth("abc");
class Holder {
  static held = Bun;
  field = Bun;
}
attempt("the global", () => Bun.escapeHTML("<a>"));
attempt("globalThis", () => globalThis.Bun.stripANSI("\x1b[1mb\x1b[0m"));
attempt("a pattern", () => {
  const { deepEquals } = Bun;
  return deepEquals({ a: 1 }, { a: 1 });
});
attempt("a named import", () => importedPeek(1));
attempt("the namespace", () => namespace.indexOfLine(new Uint8Array([97, 10, 98]), 0));
attempt("the default export", () => defaultExport.fileURLToPath("file:///a/b"));
attempt("a constant", () => local.pathToFileURL("/a/b").href);
attempt("a parameter", () => through(Bun));
attempt("an element", () => [Bun][0].concatArrayBuffers([new Uint8Array([1]).buffer]).byteLength);
attempt("a property", () => ({ bun: Bun }).bun.hash.crc32("a"));
attempt("a result", () => (() => Bun)().inspect({ a: 1 }));
attempt("a static field", () => Holder.held.semver.order("1.0.0", "2.0.0"));
attempt("a field", () => new Holder().field.isMainThread);
attempt("a string in brackets", () => Bun["sleepSync"](0));
attempt("an optional chain", () => Bun?.nanoseconds() > 0);
attempt("require", () => import.meta.require("bun").deepMatch({ a: 1 }, { a: 1, b: 2 }));
attempt("a dynamic import", () => typeof dynamic.readableStreamToText);
attempt("a promise", () => typeof awaited.allocUnsafe(1).length);
