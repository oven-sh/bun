/**
 * Platform shims — small host tools/objects used at link time to
 * work around toolchain or OS bugs.
 *
 * Each shim is a ninja build edge (source → output), so ninja handles
 * rebuild-on-change. `emitShims()` registers the edges and returns the
 * implicit inputs to spread into the final link() call.
 *
 * Every shim MUST have an entry in workarounds.ts that fails configure
 * once the upstream fix ships — see that file for the pattern.
 */

import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { DARWIN_STACK_SIZE } from "./flags.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";
import { toolIdentityFile } from "./tools.ts";

/**
 * macOS-from-Linux cross links need a post-link fixup pass over every
 * Mach-O executable they produce (the linked bun-profile/bun-debug AND the
 * stripped bun):
 *
 *   - ld64.lld parses `-stack_size` but doesn't implement it (LLVM 23 still prints
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
 * Register shim compile rules. Call once from rules.ts alongside the
 * other registerXxxRules() calls.
 */
export function registerShimRules(n: Ninja, cfg: Config): void {
  const q = (p: string) => quote(p, false);

  if (needsMachoPostlink(cfg)) {
    // Host tool — compiled for the BUILD machine (no --target/-isysroot),
    // since it runs as part of the link/strip commands on this host.
    n.rule("host_tool_cc", {
      command: `${q(cfg.cc)} -std=c11 -O2 -o $out $in`,
      description: "host-tool $out",
    });
  }
}

/**
 * Emit shim build edges and return the link's implicit inputs. Call before the link() call (emitBun).
 *
 * See scripts/build/workarounds.ts for the self-obsoleting check on each.
 */
export function emitShims(n: Ninja, cfg: Config): string[] {
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
      implicitInputs: [toolIdentityFile(cfg, "cc")],
    });
    implicitInputs.push(...machoPostlinkImplicitInputs(cfg));
  }

  return implicitInputs;
}
