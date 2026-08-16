/**
 * `libbun` — Bun linked as a shared library so another program can host it
 * in-process through the C API in `packages/bun-embed/bun_embed.h`
 * (`bun_embed_run`, `bun_embed_request_exit`, `bun_embed_version`; the
 * Rust side is `src/bun_bin/embed.rs`).
 *
 * The library is linked from the very same object set as the executable —
 * only the link differs: `-dynamiclib`, no executable-only flags (stack size,
 * order file, linker map), and an exported-symbol list of `src/symbols.txt`
 * (the napi/v8 surface addons resolve against) minus `__mh_execute_header`,
 * plus `src/symbols.embed.txt`. `main` is deliberately not exported.
 *
 * It is a separate ninja target (`bun run build --target=libbun`), never a
 * default one, so the executable build is untouched. macOS only for now:
 * Linux would need the whole object set built position-independent
 * (`-fno-pic` / `-no-pie` / Rust `relocation-model=static` are the current
 * defaults), and Windows would need an import library story.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { link } from "./compile.ts";
import type { Config } from "./config.ts";
import { computeFlags, linkDepends, sharedLibExportsPath } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { needsMachoPostlink, type ShimLinkOpts } from "./shims.ts";

export const SHARED_LIB_NAME = "libbun.dylib";

/** Whether this configuration can produce libbun. */
export function canBuildSharedLib(cfg: Config): boolean {
  // The darwin cross-link appends the Mach-O post-link fixup (stack size,
  // re-sign) to the link command; both are executable-only.
  return cfg.darwin && !needsMachoPostlink(cfg);
}

/**
 * Write libbun's exported-symbol list (a configure-time constant manifest,
 * like `build_options.rs`) and emit the `libbun.dylib` link edge plus a
 * `libbun` phony. Returns the library path.
 */
export function emitSharedLib(
  n: Ninja,
  cfg: Config,
  linkObjects: string[],
  depLibs: string[],
  systemLibs: string[],
  shims: ShimLinkOpts,
): string {
  const libCfg: Config = { ...cfg, sharedLib: true };

  const exeSymbols = readFileSync(join(cfg.cwd, "src/symbols.txt"), "utf8")
    .split("\n")
    .filter(s => s.length > 0 && s !== "__mh_execute_header");
  const embedSymbols = readFileSync(join(cfg.cwd, "src/symbols.embed.txt"), "utf8")
    .split("\n")
    .filter(s => s.length > 0 && !s.startsWith("#"));
  writeIfChanged(sharedLibExportsPath(cfg), [...exeSymbols, ...embedSymbols].join("\n") + "\n");

  const flags = computeFlags(libCfg);
  const lib = link(n, libCfg, SHARED_LIB_NAME, linkObjects, {
    libs: depLibs,
    flags: [...flags.ldflags, ...systemLibs, ...shims.ldflags],
    implicitInputs: [
      ...linkDepends(libCfg),
      join(cfg.cwd, "src/symbols.txt"),
      join(cfg.cwd, "src/symbols.embed.txt"),
      ...shims.implicitInputs,
    ],
  });
  n.phony("libbun", [lib]);
  return lib;
}
