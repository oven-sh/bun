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
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Config } from "./config.ts";
import { DARWIN_STACK_SIZE } from "./flags.ts";
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
 * macOS-from-Linux cross links need a post-link fixup pass over every
 * Mach-O executable they produce (the linked bun-profile/bun-debug AND the
 * stripped bun):
 *
 *   - ld64.lld parses `-stack_size` but doesn't implement it (LLVM 21 prints
 *     "not yet implemented"), so LC_MAIN.stacksize stays 0 → the 8 MB
 *     default instead of the 18 MB JSC needs. Tracked in workarounds.ts
 *     ("darwin-cross-stack-size").
 *   - arm64 only: the ad-hoc signature the linker emits has no entitlements,
 *     and any header edit (the stack-size patch) invalidates it anyway —
 *     arm64 macOS refuses to exec a binary with a stale CodeDirectory. The
 *     fixup regenerates the ad-hoc signature with the entitlements embedded
 *     (matching what `codesign --sign - --entitlements` produces). x64 ships
 *     unsigned, like the native x64 build: Apple's ld only auto-signs arm64,
 *     x64 macOS runs unsigned binaries fine, and the CodeDirectory costs
 *     ~0.8% of the binary (32-byte SHA-256 per 4 KB page).
 *
 * `shims/macho-postlink.c` is a standalone host tool that does both in
 * place. It's compiled for the BUILD HOST (no --target/-isysroot), then
 * appended to the link and strip rule commands as `... -o $out && macho-
 * postlink $out ...`.
 */
export function needsMachoPostlink(cfg: Config): boolean {
  return cfg.darwin && cfg.crossTarget !== undefined;
}

/** Host-compiled fixup tool. Lives next to the executables it patches. */
export function machoPostlinkToolPath(cfg: Config): string {
  return resolve(cfg.buildDir, "macho-postlink");
}

/**
 * Entitlements applied to the cross-built binary. Matches what the release
 * pipeline's `codesign --entitlements` uses for native builds: the debug
 * plist additionally grants get-task-allow / cs.debugger so lldb can attach.
 */
export function machoEntitlementsPlist(cfg: Config): string {
  return resolve(cfg.cwd, cfg.debug ? "entitlements.debug.plist" : "entitlements.plist");
}

/**
 * Command suffix to append to a rule that produces a Mach-O executable at
 * `$out` (the link rule and the strip rule). Empty string when the fixup
 * isn't needed so callers can append unconditionally.
 */
export function machoPostlinkCommand(cfg: Config): string {
  if (!needsMachoPostlink(cfg)) return "";
  const q = (p: string) => quote(p, false);
  // x64 has no LC_CODE_SIGNATURE to re-sign (see the -adhoc_codesign flag
  // entry) — only the stack size is patched. macho-postlink errors if asked
  // to embed entitlements into an unsigned binary, which is the safety net
  // that keeps arm64 from ever silently shipping unsigned.
  const entitlements = cfg.arm64 ? ` --entitlements=${q(machoEntitlementsPlist(cfg))}` : "";
  return ` && ${q(machoPostlinkToolPath(cfg))} $out --stack-size=${DARWIN_STACK_SIZE}${entitlements}`;
}

/**
 * Files the link/strip edges must list as implicit inputs when the postlink
 * command suffix is appended: the tool itself and the entitlements plist it
 * reads. Empty when the fixup isn't needed.
 */
export function machoPostlinkImplicitInputs(cfg: Config): string[] {
  if (!needsMachoPostlink(cfg)) return [];
  if (!cfg.arm64) return [machoPostlinkToolPath(cfg)];
  return [machoPostlinkToolPath(cfg), machoEntitlementsPlist(cfg)];
}

/**
 * ELF + rust-lld: rust-lang/llvm-project builds lld without LLVM_ENABLE_ZLIB,
 * so `-Wl,--compress-debug-sections=zlib` is dropped when the crosslang-LTO
 * rust-lld swap is active (flags.ts). Uncompressed DWARF makes bun-profile
 * ~2x larger (~900MB), and every `bun build --compile` in the test suite
 * copies the running binary, so the size shows up as CI test timeouts, not
 * just artifact bloat. Compress after the link with llvm-objcopy instead —
 * same tool the musl CRT decompress shim already relies on.
 */
export function needsElfDebugCompressPostlink(cfg: Config): boolean {
  return (cfg.linux || cfg.freebsd) && cfg.rustLld !== undefined && cfg.ld === cfg.rustLld;
}

/**
 * Command suffix for the link rule: `... -o $out && llvm-objcopy
 * --compress-debug-sections=zlib $out`. Empty when not needed so callers
 * can append unconditionally (mutually exclusive with machoPostlinkCommand).
 */
export function elfDebugCompressPostlinkCommand(cfg: Config): string {
  if (!needsElfDebugCompressPostlink(cfg)) return "";
  const llvmObjcopy = resolve(dirname(cfg.cc), "llvm-objcopy");
  return ` && ${quote(existsSync(llvmObjcopy) ? llvmObjcopy : "llvm-objcopy", false)} --compress-debug-sections=zlib $out`;
}

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
 * HarmonyOS app sandboxes SIGSYS-kill several seccomp-filtered syscalls
 * (close_range, fchmodat2 — the kill fires before any errno fallback can
 * run) and return sandbox-specific errno from a few libc calls
 * (getpwuid_r, tmpfile, getcwd). ohos-compat-shim handles all of these
 * with a probe-then-fallback interposer, historically LD_PRELOAD'd by the
 * harmonybrew formula wrapper scripts. Linking a vendored copy
 * (shims/ohos_compat_shim.c) straight into the executable removes the
 * wrapper requirement — for bun itself AND for every `bun build --compile`
 * output, which embeds this runtime. Tracked in workarounds.ts
 * ("ohos-compat-shim-embed").
 */
function needsOhosCompatShim(cfg: Config): boolean {
  return cfg.ohos;
}

/**
 * The shim's interposed symbols are re-exported from the executable via the
 * global list in src/linker.lds so dlopen'd native modules (.node/.so)
 * resolve them from the main binary too — the executable is first in the
 * loader's global lookup order, which matches LD_PRELOAD interposition
 * semantics. NOTE: the version script's `local: *` overrides
 * --export-dynamic-symbol/--dynamic-list in lld (verified empirically on
 * LLD 21), so linker.lds is the only working export mechanism here.
 * linkat/symlinkat/splice interposers are default-on and can be disabled
 * per-symbol via OHOS_COMPAT_SHIM_DISABLE, same as the preload .so.
 */

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

  if (needsMachoPostlink(cfg)) {
    // Host tool — compiled for the BUILD machine (no --target/-isysroot),
    // since it runs as part of the link/strip commands on this host.
    n.rule("host_tool_cc", {
      command: `${q(cfg.cc)} -std=c11 -O2 -o $out $in`,
      description: "host-tool $out",
    });
  }

  if (needsMuslCrtDecompress(cfg)) {
    // llvm-objcopy (multi-target; host GNU objcopy rejects foreign-arch ELF).
    // Resolve it next to clang (debian has no unversioned symlink on PATH).
    // restat=1: a no-op decompress keeps the mtime so the link doesn't re-run.
    const llvmObjcopy = resolve(dirname(cfg.cc), "llvm-objcopy");
    n.rule("shim_crt_decompress", {
      command: `${q(existsSync(llvmObjcopy) ? llvmObjcopy : "llvm-objcopy")} --decompress-debug-sections $in $out`,
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

  if (needsMachoPostlink(cfg)) {
    // The link rule's command ends with `&& macho-postlink $out ...`
    // (see machoPostlinkCommand), so the tool and the entitlements plist it
    // reads must exist before the link runs and must trigger a relink when
    // they change.
    n.build({
      outputs: [machoPostlinkToolPath(cfg)],
      rule: "host_tool_cc",
      inputs: [resolve(cfg.cwd, "scripts", "build", "shims", "macho-postlink.c")],
    });
    implicitInputs.push(...machoPostlinkImplicitInputs(cfg));
  }

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

    // Cross-compiling musl from a glibc host: point the probe at the musl
    // sysroot so clang resolves the CRT there instead of the host /usr/lib.
    // Native musl (sysroot undefined) keeps the bare probe.
    const probeArgs = cfg.sysroot !== undefined ? [`--target=${cfg.crossTarget!}`, `--sysroot=${cfg.sysroot}`] : [];

    for (const name of MUSL_CRT_OBJECTS) {
      // Ask clang where it would find this startfile. Legitimate
      // configure-time spawn (environment probe, not a build artifact).
      // If the file isn't installed clang echoes the bare name back —
      // skip those rather than emit a broken edge.
      const found = spawnSync(cfg.cc, [...probeArgs, `-print-file-name=${name}`], {
        encoding: "utf8",
      }).stdout.trim();
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
