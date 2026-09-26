// The functions of Windows and of libuv that the portable image can call: every function of every
// `extern` block of bun's Rust sources that has `bun_portable_macros::imports(library = "..")`.
//
//   bun imports.ts                       prints the list as JSON: library, symbol, file, line
//   bun imports.ts --write-host          writes ../host/host_win_uv.c, the table that the Windows host
//                                        answers the library "libuv" from
//   bun imports.ts --check-libuv <dir>   <dir> is a checkout of libuv: says which symbols of the
//                                        library "libuv" no source file of libuv for Windows defines
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");

export type Import = { library: string; symbol: string; file: string; line: number };

function rustFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) rustFiles(path, out);
    else if (name.endsWith(".rs")) out.push(path);
  }
  return out;
}

export function collectImports(): Import[] {
  const imports: Import[] = [];
  const files = [...rustFiles(join(repo, "src")), ...rustFiles(join(repo, "misctools/portable/slice/src"))];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("bun_portable_macros::imports")) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // The attribute is on one line, or its argument is on the line after `#[cfg_attr(`.
      const window = lines.slice(i, i + 4).join(" ");
      const attribute =
        /^\s*#\[(?:cfg_attr\(\s*bun_portable,\s*)?bun_portable_macros::imports\(library = "([^"]+)"\)/.exec(window);
      if (
        !attribute ||
        !/bun_portable_macros::imports|#\[cfg_attr\($/.test(lines[i]) ||
        (i > 0 && /#\[cfg_attr\($/.test(lines[i - 1].trim()) && !lines[i].includes("#["))
      )
        continue;
      if (!lines[i].trim().startsWith("#[")) continue;
      let at = i;
      while (at < lines.length && !/extern "(C|system)" \{\s*$/.test(lines[at])) at++;
      const indent = /^(\s*)/.exec(lines[at])![1];
      let linkName: string | undefined;
      let library: string | undefined;
      for (let k = at + 1; k < lines.length && lines[k] !== indent + "}"; k++) {
        const link = /#\[link_name = "([^"]+)"\]/.exec(lines[k]);
        if (link) linkName = link[1];
        const own = /#\[cfg_attr\(bun_portable, library = "([^"]+)"\)\]/.exec(lines[k]);
        if (own) library = own[1];
        const fn = /^\s*(?:pub(?:\([a-z]+\))? )?(?:safe |unsafe )?fn ([A-Za-z_0-9]+)\s*\(/.exec(lines[k]);
        if (fn) {
          imports.push({
            library: library ?? attribute[1],
            symbol: linkName ?? fn[1],
            file: relative(repo, file),
            line: k + 1,
          });
          linkName = library = undefined;
        }
      }
      i = at;
    }
  }
  return imports;
}

function hostTable(symbols: string[]): string {
  const list = symbols.map(name => `  UV(${name})`).join(" \\\n");
  return `// Written by misctools/portable/bindings/imports.ts from the bindings of bun. Do not edit.
//
// The functions of libuv that the portable image can call. libuv has no DLL: it is linked into the
// Windows host (host_win.c, BUN_HOST_LIBUV), and the host answers the library "libuv" of the image's
// import table from this table. Every function is named here, so the linker takes it from libuv, and
// a function that this libuv does not have is an error of the link of the host.
//
// The declarations do not give the types of the functions: the host only takes their addresses.
#include <string.h>

#define BUN_HOST_UV_SYMBOLS(UV) \\
${list}

#define UV(name) void name(void);
BUN_HOST_UV_SYMBOLS(UV)
#undef UV

static const struct {
  const char *name;
  void (*address)(void);
} symbols[] = {
#define UV(name) {#name, name},
  BUN_HOST_UV_SYMBOLS(UV)
#undef UV
};

void *bun_host_uv_lookup(const char *symbol) {
  for (size_t i = 0; i < sizeof symbols / sizeof *symbols; i++)
    if (!strcmp(symbol, symbols[i].name)) return (void *)symbols[i].address;
  return 0;
}
`;
}

if (import.meta.main) {
  const imports = collectImports();
  const uv = [...new Set(imports.filter(i => i.library === "libuv").map(i => i.symbol))].sort();
  const [mode, argument] = process.argv.slice(2);
  if (mode === "--write-host") {
    const path = join(here, "../host/host_win_uv.c");
    writeFileSync(path, hostTable(uv));
    console.log(`${path}: ${uv.length} functions`);
  } else if (mode === "--check-libuv") {
    const sources = ["src", "src/win"].flatMap(dir =>
      readdirSync(join(argument, dir))
        .filter(n => n.endsWith(".c"))
        .map(n => readFileSync(join(argument, dir, n), "utf8")),
    );
    // loop-watcher.c defines uv_<kind>_init, _start and _stop with one macro for each kind.
    const byMacro = (name: string) => {
      const watcher = /^uv_([a-z]+)_(init|start|stop)$/.exec(name);
      return watcher !== null && sources.some(text => text.includes(`UV_LOOP_WATCHER_DEFINE(${watcher[1]},`));
    };
    const missing = uv.filter(
      name =>
        !byMacro(name) &&
        !sources.some(text => new RegExp(`^[A-Za-z_][A-Za-z_0-9 \\*]*\\b${name}\\s*\\(`, "m").test(text)),
    );
    console.log(JSON.stringify({ functions: uv.length, not_defined_by_libuv: missing }, null, 1));
    if (missing.length) process.exit(1);
  } else {
    console.log(JSON.stringify(imports, null, 1));
  }
}
