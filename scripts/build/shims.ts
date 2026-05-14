/**
 * Platform shims — small dylibs/objects linked into the bun executable to
 * work around toolchain or OS bugs.
 *
 * Each shim is a ninja build edge (source → output), so ninja handles
 * rebuild-on-change. `emitShims()` registers the edges and returns the
 * linker flags + implicit inputs to spread into the final link() call.
 *
 * Every shim MUST have an entry in workarounds.ts that fails configure
 * once the upstream fix ships — see that file for the pattern.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";

export interface ShimLinkOpts {
  /** Extra ldflags to append to the link() call. */
  ldflags: string[];
  /** Implicit inputs — ninja relinks if these change. */
  implicitInputs: string[];
}

const ASAN_DYLD_SHIM = "asan-dyld-shim.dylib";

/**
 * musl + rust-lld: Alpine ships the libc CRT objects (Scrt1.o, crti.o,
 * crtn.o) with ELFCOMPRESS_ZLIB debug sections, but rust-lang/llvm-project
 * builds lld without LLVM_ENABLE_ZLIB so rust-lld errors at input-section
 * parse time ("compressed with ELFCOMPRESS_ZLIB, but lld is not built with
 * zlib support") — before --strip-debug or any output decision could skip
 * them. We only fall onto rust-lld for cross-language LTO (config.ts swap),
 * so when that swap fires on musl we copy the CRTs through `objcopy
 * --decompress-debug-sections` into the build dir and prepend it as a -B
 * search path so clang's driver picks the decompressed copies.
 */
function needsMuslCrtDecompress(cfg: Config): boolean {
  return cfg.linux && cfg.abi === "musl" && cfg.rustLld !== undefined && cfg.ld === cfg.rustLld;
}

/** CRT objects clang's linux driver may pass. crt1/Scrt1 both covered so PIE-default changes don't matter. */
const MUSL_CRT_OBJECTS = ["Scrt1.o", "crt1.o", "crti.o", "crtn.o"];

/**
 * Register shim compile rules. Call once from rules.ts alongside the
 * other registerXxxRules() calls.
 */
export function registerShimRules(n: Ninja, cfg: Config): void {
  const q = (p: string) => quote(p, false);

  if (cfg.darwin && cfg.asan) {
    // -install_name @rpath/<name> so dyld resolves it next to the
    // executable via the -rpath @executable_path we add at link time.
    // __DATA,__interpose only works from dylibs (not object files linked
    // into the main binary), hence -dynamiclib.
    n.rule("shim_dylib", {
      command: `${q(cfg.cc)} -dynamiclib -O2 -install_name @rpath/$name -o $out $in`,
      description: "shim $name",
    });
  }

  if (needsMuslCrtDecompress(cfg)) {
    // binutils objcopy (same package as `strip`, already required on linux —
    // see tools.ts). restat=1: a no-op decompress keeps the mtime so the
    // link doesn't re-run.
    n.rule("shim_crt_decompress", {
      command: `objcopy --decompress-debug-sections $in $out`,
      description: "decompress-crt $out",
      restat: true,
    });
  }
}

/**
 * Emit shim build edges and return link flags. Call once per link site
 * (emitBun, emitLinkOnly) before the link() call.
 *
 * See scripts/build/workarounds.ts for the self-obsoleting check on each.
 */
export function emitShims(n: Ninja, cfg: Config): ShimLinkOpts {
  const ldflags: string[] = [];
  const implicitInputs: string[] = [];

  if (cfg.darwin && cfg.asan) {
    // macOS 26.4 ASAN dyld deadlock — see shims/asan-dyld-shim.c.
    const src = resolve(cfg.cwd, "scripts", "build", "shims", "asan-dyld-shim.c");
    const out = resolve(cfg.buildDir, ASAN_DYLD_SHIM);
    n.build({
      outputs: [out],
      rule: "shim_dylib",
      inputs: [src],
      vars: { name: ASAN_DYLD_SHIM },
    });
    ldflags.push(out, "-Wl,-rpath,@executable_path");
    implicitInputs.push(out);
  }

  if (needsMuslCrtDecompress(cfg)) {
    const crtDir = resolve(cfg.buildDir, "crt");
    // Pre-create at configure time (matches configure.ts mkdirAll pattern;
    // tiny dir, no point routing through the obj-dir set).
    mkdirSync(crtDir, { recursive: true });

    for (const name of MUSL_CRT_OBJECTS) {
      // Ask clang where it would find this startfile. Legitimate
      // configure-time spawn (environment probe, not a build artifact).
      // If the file isn't installed clang echoes the bare name back —
      // skip those rather than emit a broken edge.
      const found = spawnSync(cfg.cc, [`-print-file-name=${name}`], { encoding: "utf8" }).stdout.trim();
      if (!found || found === name) continue;
      const out = resolve(crtDir, name);
      n.build({ outputs: [out], rule: "shim_crt_decompress", inputs: [found] });
      implicitInputs.push(out);
    }

    // -B prepends to clang's startfile/library search paths, so the driver
    // resolves Scrt1.o/crti.o/crtn.o here before /usr/lib.
    ldflags.push(`-B${crtDir}`);
  }

  return { ldflags, implicitInputs };
}
