// Checks the import table of a portable image against the import libraries of the Windows SDK: is
// every function in the library that the image asks the host for?
//
//   bun imports-libraries.ts <imports.jsonl> --sdk <directory> [--host-table ../host/host_win_uv.c]
//
// <imports.jsonl> is what `<image> --imports` prints on a host that is not Windows, where no import
// resolves: one line for each import, with its library and its symbol. <directory> is what
// ../tools/windows-sdk.ts made. An import library of the SDK (kernel32.lib) names the functions that
// the DLL of that name exports, so this is the check that the Windows host makes with GetProcAddress
// (`--imports` on Windows), on a machine that has the SDK and no Windows.
//
//   a library "x"      x.lib of the SDK has to have the symbol
//   "ucrtbase"         the C runtime: ucrt.lib
//   "libuv"            libuv is linked into the host: the table of the host has to name the symbol
//                      (the link of the host fails if libuv does not define a name of the table)
//   "*"                a declaration of bun that names no library: the libraries that the host asks
//                      for such a function, in its order (host_win.c, `always`)
//
// Prints what was not found, and where else the SDK has it. Exit code 1 if anything was not found.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const list = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const sdk = option("--sdk");
if (!list || !sdk) throw new Error("usage: bun imports-libraries.ts <imports.jsonl> --sdk <directory> [--host-table host_win_uv.c]");
const libraries = join(resolve(sdk), "lib-x64");
const hostTable = readFileSync(option("--host-table", join(here, "../host/host_win_uv.c"))!, "utf8");
const hostSource = readFileSync(join(here, "../host/host_win.c"), "utf8");
const nm = process.env.LLVM_NM ?? "/usr/lib/llvm-current/bin/llvm-nm";

const inTable = new Set([...hostTable.matchAll(/^\s*UV\(([A-Za-z_0-9]+)\)/gm)].map(m => m[1]));
const always = [...(/always\[\] = \{([^}]*)\}/.exec(hostSource)?.[1] ?? "").matchAll(/L"([^"]+)"/g)].map(m => m[1]);
if (!always.length) throw new Error("host_win.c: the list `always` was not found");
const fileOf = (library: string) => (library === "ucrtbase" ? "ucrt" : library);

/** symbol -> the DLL that the import library names for it */
const known = new Map<string, Map<string, string> | undefined>();
function exportsOf(library: string) {
  if (known.has(library)) return known.get(library);
  const path = join(libraries, `${fileOf(library)}.lib`);
  let found: Map<string, string> | undefined;
  if (existsSync(path)) {
    found = new Map();
    const result = Bun.spawnSync([nm, "--defined-only", path], { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
    let dll = "";
    for (const line of result.stdout.toString().split("\n")) {
      const member = /^(.*):$/.exec(line);
      if (member) dll = member[1];
      const symbol = /^[0-9a-f]+ T __imp_(.+)$/.exec(line);
      if (symbol) found.set(symbol[1], dll);
    }
  }
  known.set(library, found);
  return found;
}

type Line = { step: string; library: string; symbol: string };
const imports: Line[] = readFileSync(list, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => JSON.parse(line))
  .filter(line => line.step === "import");
const notFound: { library: string; symbol: string; why: string; the_sdk_has_it_in: string[] }[] = [];
const byLibrary: Record<string, number> = {};
const unnamed: Record<string, string> = {};
// Where else a function is: the libraries of the image, and the ones that hold what a DLL of Windows
// passes on to another.
const others = [...new Set([...imports.map(i => i.library).filter(l => l !== "libuv" && l !== "*"), ...always, "kernelbase", "synchronization", "onecore"])];
for (const { library, symbol } of imports) {
  byLibrary[library] = (byLibrary[library] ?? 0) + 1;
  let why: string | undefined;
  if (library === "libuv") {
    if (!inTable.has(symbol)) why = "the table of the host (host_win_uv.c) does not name it";
  } else if (library === "*") {
    const first = always.find(name => exportsOf(name)?.has(symbol));
    if (first) unnamed[symbol] = first;
    else why = `none of ${always.join(", ")} has it`;
  } else {
    const found = exportsOf(library);
    if (!found) why = `the SDK has no ${fileOf(library)}.lib`;
    else if (!found.has(symbol)) why = `${fileOf(library)}.lib does not have it`;
  }
  if (why) notFound.push({ library, symbol, why, the_sdk_has_it_in: others.filter(name => name !== library && exportsOf(name)?.has(symbol)) });
}
console.log(
  JSON.stringify(
    { imports: imports.length, by_library: byLibrary, found_for_a_declaration_without_a_library: unnamed, not_found: notFound },
    null,
    1,
  ),
);
process.exit(notFound.length ? 1 : 0);
