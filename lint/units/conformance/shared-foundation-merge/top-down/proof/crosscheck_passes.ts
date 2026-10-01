// The merged set of this pass (../runner) against the merged set of the other pass (../../bottom-up/runner):
// every function that both export under one name, on the inputs of the ground-truth vectors. The two sets were
// merged from the same copies by two passes; this tells the differences that are left.
// usage: bun crosscheck_passes.ts [govec.jsonl.gz]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const here = import.meta.dir;
const td = here + "/../runner/";
const bu = here + "/../../bottom-up/runner/";
const T = {
  gostrings: { ...(await import(td + "gostrings.ts")), ...(await import(td + "bytestring.ts")) },
  core: await import(td + "core.ts"),
  scanner: await import(td + "scanner.ts"),
  stringutil: await import(td + "stringutil.ts"),
  tspath: await import(td + "tspath.ts"),
  vfs: await import(td + "vfs.ts"),
  text_model: await import(td + "text_model.ts"),
} as Record<string, Record<string, any>>;
const B = {
  gostrings: await import(bu + "gostrings.ts"),
  core: await import(bu + "core.ts"),
  scanner: await import(bu + "scanner.ts"),
  stringutil: await import(bu + "stringutil.ts"),
  tspath: await import(bu + "tspath.ts"),
  vfs: await import(bu + "vfs.ts"),
  text_model: await import(bu + "text_model.ts"),
} as Record<string, Record<string, any>>;

const vecPath = process.argv[2] ?? here + "/../vectors/govec.jsonl.gz";
const rows = (vecPath.endsWith(".gz") ? gunzipSync(readFileSync(vecPath)) : readFileSync(vecPath))
  .toString("utf8")
  .split("\n")
  .filter(l => l !== "")
  .map(l => JSON.parse(l));
const b = (s: string): string => Buffer.from(s, "base64").toString("latin1");

const compared: Record<string, number> = {};
const different: Record<string, number> = {};
const examples: string[] = [];
const show = (x: unknown): string => {
  if (x instanceof Uint8Array) return "bytes:" + Buffer.from(x).toString("hex");
  if (x instanceof Set) return JSON.stringify([...x]);
  return JSON.stringify(x) ?? "undefined";
};
function call(f: (...a: any[]) => unknown, args: unknown[]): string {
  try {
    return show(f(...args));
  } catch (e) {
    // The two sets name the error of a lone surrogate differently: a throw is a throw.
    return "throws";
  }
}
function both(module: string, name: string, args: unknown[]): void {
  const key = module + "." + name;
  const f = T[module][name];
  const g = B[module][name];
  if (typeof f !== "function" || typeof g !== "function") throw new Error("not in both sets: " + key);
  compared[key] = (compared[key] ?? 0) + 1;
  const x = call(f, args);
  const y = call(g, args);
  if (x !== y) {
    different[key] = (different[key] ?? 0) + 1;
    if (examples.length < 12) examples.push(`${key}(${args.map(a => show(a)).join(", ").slice(0, 120)}): this pass ${x.slice(0, 80)}, the other ${y.slice(0, 80)}`);
  }
}

// Names that one set has and the other has not.
for (const m of Object.keys(T)) {
  const t = Object.keys(T[m]).sort();
  const o = Object.keys(B[m]).sort();
  const onlyT = t.filter(n => !o.includes(n));
  const onlyB = o.filter(n => !t.includes(n));
  if (onlyT.length + onlyB.length > 0) console.log(`${m}: only in this pass [${onlyT.join(", ")}], only in the other [${onlyB.join(", ")}]`);
}

for (let r = 0; r <= 0x10ffff; r++) {
  for (const n of ["isSpace", "unicodeToLower", "foldKey"]) both("gostrings", n, [r]);
  for (const n of ["isWhiteSpaceLike", "isWhiteSpaceSingleLine", "isLineBreak"]) both("stringutil", n, [r]);
}
const sensitive = (currentDirectory: string) => ({ useCaseSensitiveFileNames: true, currentDirectory });
const insensitive = (currentDirectory: string) => ({ useCaseSensitiveFileNames: false, currentDirectory });
for (const v of rows) {
  if (v.k === "text") {
    const s = b(v.s);
    for (const n of ["runeCount", "trimRightSpace", "replaceNonWhitespace", "byteStringToUtf8"]) both("gostrings", n, [s]);
    both("gostrings", "fromByteString", [s]);
    both("gostrings", "toByteString", [Buffer.from(s, "latin1")]);
    both("gostrings", "utf8String", [Buffer.from(s, "latin1")]);
    both("core", "computeECMALineStarts", [s]);
    both("core", "utf16Len", [s]);
    const starts = T.core.computeECMALineStarts(s);
    for (let p = 0; p <= s.length; p++) {
      both("scanner", "skipTrivia", [s, p]);
      both("scanner", "computeLineOfPosition", [starts, p]);
      both("gostrings", "decodeRune", [s, p]);
      both("gostrings", "decodeLastRune", [s, 0, p]);
    }
    for (const model of ["utf8Model", "utf16Model"]) {
      const mt = T.text_model[model];
      const mb = B.text_model[model];
      const text = model === "utf8Model" ? s : v.valid ? T.gostrings.byteStringToUtf8(s) : undefined;
      if (text === undefined) continue;
      const m = (name: string, args: unknown[]) => {
        const key = `text_model.${model}.${name}`;
        compared[key] = (compared[key] ?? 0) + 1;
        const x = call(mt[name].bind(mt), args);
        const y = call(mb[name].bind(mb), args);
        if (x !== y) {
          different[key] = (different[key] ?? 0) + 1;
          if (examples.length < 12) examples.push(`${key}: this pass ${x.slice(0, 80)}, the other ${y.slice(0, 80)}`);
        }
      };
      m("lineStarts", [text]);
      m("contentLines", [text]);
      m("squiggleCount", [text]);
      m("blankNonWhitespace", [text]);
      m("trimEnd", [text]);
      m("toBytes", [text]);
      m("toString", [text]);
      m("fromBytes", [Buffer.from(s, "latin1")]);
      m("prefixCount", [text]);
      m("compare", [text, "a"]);
      for (let p = 0; p <= text.length; p += 3) {
        m("utf16Length", [text, 0, p]);
        m("advanceUTF16", [text, 0, p, text.length]);
        m("advanceSquiggle", [text, 0, p]);
      }
      if (v.valid) m("fromString", [T.gostrings.byteStringToUtf8(s)]);
    }
    if (v.valid) {
      const d = T.gostrings.byteStringToUtf8(s);
      for (const n of ["trimSpace", "toLower", "utf8ToByteString", "utf8Bytes"]) both("gostrings", n, [d]);
      both("gostrings", "trimFunc", [d, T.stringutil.isWhiteSpaceLike]);
      both("gostrings", "trimSuffix", [d, ";"]);
      both("tspath", "toFileNameLowerCase", [d]);
    }
  } else if (v.k === "pair") {
    const x = T.gostrings.byteStringToUtf8(b(v.a));
    const y = T.gostrings.byteStringToUtf8(b(v.b));
    both("gostrings", "equalFold", [x, y]);
    both("gostrings", "compareStrings", [x, y]);
    for (const n of ["compareStringsCaseInsensitive", "compareStringsCaseSensitive", "equateStringCaseInsensitive", "equateStringCaseSensitive"]) both("stringutil", n, [x, y]);
  } else if (v.k === "path") {
    const name = T.gostrings.byteStringToUtf8(b(v.name));
    const dir = T.gostrings.byteStringToUtf8(b(v.dir));
    for (const n of [
      "normalizePath",
      "getDirectoryPath",
      "getBaseFileName",
      "getRootLength",
      "getEncodedRootLength",
      "isRootedDiskPath",
      "pathIsAbsolute",
      "hasExtension",
      "toFileNameLowerCase",
      "removeTrailingDirectorySeparator",
      "removeTrailingDirectorySeparators",
      "ensureTrailingDirectorySeparator",
      "hasTrailingDirectorySeparator",
      "normalizeSlashes",
    ]) {
      both("tspath", n, [name]);
    }
    for (const n of ["getNormalizedAbsolutePath", "combinePaths", "getNormalizedPathComponents", "getPathComponents"]) both("tspath", n, [name, dir]);
    both("tspath", "reducePathComponents", [T.tspath.getPathComponents(name, dir)]);
    both("tspath", "getPathFromPathComponents", [T.tspath.getPathComponents(name, dir)]);
    for (const cs of [true, false]) {
      both("tspath", "toPath", [name, dir, cs]);
      both("tspath", "getCanonicalFileName", [name, cs]);
      const plain = cs ? sensitive("") : insensitive("");
      both("tspath", "comparePaths", [name, dir, plain]);
      both("tspath", "containsPath", [dir, name, plain]);
      both("tspath", "convertToRelativePath", [name, cs ? sensitive(dir) : insensitive(dir)]);
      both("tspath", "getPathComponentsRelativeTo", [dir, name, plain]);
    }
    both("tspath", "getAnyExtensionFromPath", [name, undefined, false]);
    both("tspath", "fileExtensionIs", [name, ".d.ts"]);
    both("tspath", "fileExtensionIsOneOf", [name, [".ts", ".tsx"]]);
    both("tspath", "changeExtension", [name, ".ts"]);
  } else if (v.k === "ext") {
    const name = T.gostrings.byteStringToUtf8(b(v.name));
    const list = v.extensions.map((x: string) => T.gostrings.byteStringToUtf8(b(x)));
    both("tspath", "getAnyExtensionFromPath", [name, list, v.ignoreCase]);
    both("tspath", "changeAnyExtension", [name, ".x", list, v.ignoreCase]);
  } else if (v.k === "decode") {
    both("vfs", "decodeBytes", [Buffer.from(v.bytes, "base64")]);
    both("vfs", "decodeUtf16", [Buffer.from(v.bytes, "base64"), true]);
    both("vfs", "decodeUtf16", [Buffer.from(v.bytes, "base64"), false]);
  } else if (v.k === "atoi") {
    both("gostrings", "atoi", [b(v.s)]);
  }
}
for (const [s, w] of [["ab", 5], ["abc", 1], ["", 0], ["x", 3]] as const) both("gostrings", "padLeft", [s, w]);
for (const s of ["a\ud800", "\udc00", "ok", "\u00e9"]) {
  for (const n of ["utf8ToByteString", "utf8Bytes"]) both("gostrings", n, [s]);
  for (const model of ["utf8Model", "utf16Model"]) {
    for (const name of ["fromString", "toBytes"]) {
      if (model === "utf8Model" && name === "toBytes") continue;
      const key = `text_model.${model}.${name} of a lone surrogate`;
      compared[key] = (compared[key] ?? 0) + 1;
      const x = call(T.text_model[model][name], [s]);
      const y = call(B.text_model[model][name], [s]);
      if (x !== y) {
        different[key] = (different[key] ?? 0) + 1;
        if (examples.length < 12) examples.push(`${key} ${JSON.stringify(s)}: this pass ${x}, the other ${y}`);
      }
    }
  }
}

const names = Object.keys(compared);
const total = names.reduce((n, k) => n + compared[k], 0);
console.log(`functions compared ${names.length}, calls ${total}, functions with a difference ${Object.keys(different).length}`);
for (const [k, n] of Object.entries(different)) console.log(`   ${k}: ${n} of ${compared[k]}`);
for (const e of examples) console.log("   " + e);
process.exit(Object.keys(different).length === 0 ? 0 : 1);
