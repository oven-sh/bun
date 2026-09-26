// Whether macOS has every function that the portable image binds, on a machine that is no Mac.
//
//   bun darwin-exports.ts <x86_64|aarch64> <imports.jsonl> [--sdk <directory>] [--header <exports.h>]
//
// <imports.jsonl> is what `bun_fs_slice.img --imports` prints: one line for every entry of the import
// tables of the image. On a Mac the host binds each entry of the library "libSystem" with
// dlsym(RTLD_DEFAULT, symbol), or with a function of its own for a function of macOS that takes a
// variable number of arguments (bun_host_darwin_<name><arguments>). Here the same question is put to
//
//   usr/lib/libSystem.tbd of the SDK (tools/macos-sdk.ts): the names that libSystem and the libraries
//   behind it export for the processor. A function named `f` in C is the symbol `_f`.
//   host/host_posix.c: the functions that the host hands out under its own names.
//
// --header <exports.h>: the names that were found, as a list of C, for the stand-in of libSystem on
// the Linux test host (test/libsystem_on_linux.h), which has to know a name of macOS from a name
// that is none.
//
// Prints every symbol that neither has, and fails if there is one. That the libraries of a Mac export
// what the list of the SDK says is for the Mac to confirm (run-on-mac.sh, step 3).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const argv = process.argv.slice(2);
const [arch, importsPath] = argv;
if ((arch !== "x86_64" && arch !== "aarch64") || !importsPath) throw new Error("usage: bun darwin-exports.ts <x86_64|aarch64> <imports.jsonl> [--sdk directory]");
const sdk = resolve(argv.includes("--sdk") ? argv[argv.indexOf("--sdk") + 1] : join(work, "ref/macos-sdk"));
if (!existsSync(join(sdk, "SDK.txt"))) {
  const made = Bun.spawnSync(["bun", join(here, "../tools/macos-sdk.ts"), "--out", sdk], { stdout: "inherit", stderr: "inherit" });
  if (made.exitCode !== 0) throw new Error("tools/macos-sdk.ts did not make the SDK");
}

/** The symbols that a text file of exports (.tbd, version 4) lists for a target, with the library of each. */
export function exportsOf(text: string, target: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const document of text.split(/^--- !tapi-tbd$/m)) {
    const library = /^install-name:\s*'?([^'\n]+)'?\s*$/m.exec(document)?.[1];
    if (!library) continue;
    let section = "";
    let targets: string[] = [];
    const lines = document.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const top = /^([\w-]+):/.exec(lines[i]);
      if (top) section = top[1];
      if (section !== "exports" && section !== "reexports") continue;
      const key = /^\s+(?:- )?([\w-]+):\s*\[/.exec(lines[i]);
      if (!key) continue;
      // A list goes on to its closing bracket, over as many lines as it needs.
      let list = lines[i].slice(lines[i].indexOf("[") + 1);
      while (!list.includes("]") && i + 1 < lines.length) list += lines[++i];
      const items = list.slice(0, list.indexOf("]")).split(",").map(item => item.trim().replace(/^'(.*)'$/, "$1")).filter(Boolean);
      if (key[1] === "targets") targets = items;
      else if ((key[1] === "symbols" || key[1] === "weak-symbols") && targets.includes(target)) for (const symbol of items) out.set(symbol, library);
    }
  }
  return out;
}

const target = `${arch === "aarch64" ? "arm64" : "x86_64"}-macos`;
const exported = exportsOf(readFileSync(join(sdk, "usr/lib/libSystem.tbd"), "utf8"), target);
if (exported.size < 5000) throw new Error(`${exported.size} symbols for ${target} in libSystem.tbd: the file was not read as it is written`);
const host = readFileSync(join(here, "../host/host_posix.c"), "utf8");
const ofTheHost = new Set([...(/#define BUN_HOST_DARWIN_SHIMS\(SHIM\)([\s\S]*?)\n\/\*/.exec(host)?.[1] ?? "").matchAll(/SHIM\((\w+)\)/g)].map(match => match[1]));
const refused = new Set([...(/static const char \*const variadic_functions\[\] = \{([\s\S]*?)\};/.exec(host)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]));

type Line = { step?: string; library?: string; symbol?: string };
const wanted = new Set<string>();
for (const line of readFileSync(resolve(importsPath), "utf8").split("\n").filter(Boolean)) {
  const entry = JSON.parse(line) as Line;
  if (entry.step === "import" && entry.library === "libSystem" && entry.symbol) wanted.add(entry.symbol);
}
if (wanted.size === 0) throw new Error(`${importsPath} has no import of libSystem`);

const missing: string[] = [];
const found: string[] = [];
const from = new Map<string, number>();
for (const symbol of [...wanted].sort()) {
  if (symbol.startsWith("bun_host_darwin_")) {
    if (ofTheHost.has(symbol)) from.set("the host", (from.get("the host") ?? 0) + 1);
    else missing.push(`${symbol}: the host has no function of this name`);
    continue;
  }
  if (refused.has(symbol)) {
    missing.push(`${symbol}: the host does not hand it out, it takes a variable number of arguments`);
    continue;
  }
  const library = exported.get(`_${symbol}`);
  if (library) {
    from.set(library, (from.get(library) ?? 0) + 1);
    found.push(symbol);
  } else missing.push(`${symbol}: no library of libSystem exports _${symbol} for ${target}`);
}
console.log(`${readFileSync(join(sdk, "SDK.txt"), "utf8").trim().split("\n").join(", ")}, ${target}: ${exported.size} symbols`);
for (const [library, count] of [...from].sort((a, b) => b[1] - a[1])) console.log(`   ${count} of ${library}`);
for (const line of missing) console.log(`MISSING   ${line}`);
const header = argv.includes("--header") ? argv[argv.indexOf("--header") + 1] : undefined;
if (header) {
  writeFileSync(
    resolve(header),
    [
      "/* Written by misctools/portable/bindings/darwin-exports.ts --header. Do not edit.",
      `   The functions that the portable image binds and that libSystem exports for ${target}`,
      `   (${readFileSync(join(sdk, "SDK.txt"), "utf8").trim().split("\n").join(", ")}). */`,
      "static const char *const d_exported[] = {",
      ...found.map(symbol => `  ${JSON.stringify(symbol)},`),
      "};",
      "",
    ].join("\n"),
  );
}
console.log(`${wanted.size} functions of macOS are bound by the image, ${missing.length} of them are missing`);
process.exit(missing.length ? 1 : 0);
