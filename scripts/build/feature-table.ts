/**
 * The feature table: what lets `bun build --compile --compile-exclude-features` leave parts of the runtime out of an
 * executable (src/exe_features, src/bun_core/feature.rs). `cfg.featureTable` says whether this build has one.
 *
 * The table says which piece of the executable refers to which, and where every address is stored. Only the link knows
 * that, so it is made right after it and embedded in the stripped `bun`:
 *
 *   link    with a few more flags (flags.ts), so that the linker leaves behind what it knows. The command goes on with
 *           `bun-exe-features table`, which reads the linker's temporary files, which are large, and deletes them.
 *   strip   writes `bun.stripped` instead of `bun`.
 *   table   reduced to what cannot be read off `bun.stripped`, checked, compressed and embedded. That is `bun`.
 *
 * `bun-exe-features`, the host tool, is src/exe_features compiled for the machine that builds: what reads the table in
 * `bun build --compile` and what writes it are the same functions.
 */

import { mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { bunExeName, type Config } from "./config.ts";
import { linkerMapPath } from "./flags.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";
import { machoPostlinkCommand, machoPostlinkImplicitInputs } from "./shims.ts";
import { toolIdentityFile } from "./tools.ts";

const q = (p: string) => quote(p, false);
const directory = (cfg: Config) => resolve(cfg.buildDir, "feature-table");
const toolPath = (cfg: Config) => join(directory(cfg), "bun-exe-features");
/** The table of the link, with every fixup written out. */
const linkTable = (cfg: Config) => join(directory(cfg), `${bunExeName(cfg)}.table`);
/** lld reports identical code folding, and lld-link which library each member came from, on its standard output only. */
const printed = (cfg: Config) => (cfg.darwin ? "/dev/null" : join(directory(cfg), `${bunExeName(cfg)}.printed`));

/**
 * lld writes each temporary file next to the input it was made from. Libraries outside the build directory are in a cache
 * that other checkouts share, so the link reaches them through links of its own.
 */
export function linkFromBuildDir(cfg: Config, libs: string[]): string[] {
  if (!cfg.featureTable || cfg.darwin) return libs;
  const dir = join(directory(cfg), "lib");
  mkdirSync(dir, { recursive: true });
  return libs.map(lib => {
    if (lib.startsWith(cfg.buildDir)) return lib;
    const link = join(dir, basename(lib));
    let current: string | undefined;
    try {
      current = readlinkSync(link);
    } catch {}
    if (current !== lib) {
      rmSync(link, { force: true });
      symlinkSync(lib, link);
    }
    return link;
  });
}

/** Goes right behind the link itself in the link rule's command, before any `&&`: the redirection belongs to the linker. */
export function featureTableLinkCapture(cfg: Config): string {
  return cfg.featureTable && !cfg.darwin ? ` > ${q(printed(cfg))}` : "";
}

/** The end of the link rule's command. */
export function featureTableLinkCommand(cfg: Config): string {
  if (!cfg.featureTable) return "";
  const argv = [toolPath(cfg), "table", "$out", linkerMapPath(cfg), printed(cfg), cfg.objdump!, linkTable(cfg)];
  return ` && ${argv.map(a => (a === "$out" ? a : q(a))).join(" ")} > ${q(linkTable(cfg) + ".report")}`;
}

/** What the link edge writes besides the executable and its maps. */
export function featureTableLinkOutputs(cfg: Config): string[] {
  return cfg.featureTable ? [linkTable(cfg)] : [];
}

/** What the link edge needs besides its inputs. */
export function featureTableLinkImplicitInputs(cfg: Config): string[] {
  return cfg.featureTable ? [toolPath(cfg)] : [];
}

export function registerFeatureTableRules(n: Ninja, cfg: Config): void {
  if (!cfg.featureTable) return;
  const rustc = `${q(cfg.rustc!)} --edition 2024 -C opt-level=3 -C linker=${q(cfg.hostCc)}`;
  const library = join(directory(cfg), "libbun_exe_features.rlib");
  // The crate has no dependencies, so cargo has nothing to plan.
  n.rule("exe_features_tool", {
    command:
      `${rustc} --crate-name bun_exe_features --crate-type rlib --cfg ${q('feature="tool"')} -o ${q(library)} $lib && ` +
      `${rustc} --extern bun_exe_features=${q(library)} -o $out $in`,
    description: "host-tool $out",
  });
  const tool = q(toolPath(cfg));
  const compress = `${cfg.jsRuntime} ${q(resolve(cfg.cwd, "src", "codegen", "compress-embed.ts"))}`;
  // A Mach-O is signed last, like every other time one is written.
  n.rule("feature_table", {
    command:
      `${tool} compact $in $table $table.compact && ${compress} $table.zst $table.compact && ` +
      `${tool} embed $in $table.zst $out${machoPostlinkCommand(cfg)}`,
    description: "feature table $out",
  });
}

/** Call before the link: its command runs the tool. */
export function emitFeatureTableTool(n: Ninja, cfg: Config): void {
  if (!cfg.featureTable) return;
  mkdirSync(directory(cfg), { recursive: true });
  const crate = resolve(cfg.cwd, "src", "exe_features");
  const sources = readdirSync(crate, { recursive: true, encoding: "utf8" })
    .filter(name => name.endsWith(".rs"))
    .map(name => join(crate, name));
  n.build({
    outputs: [toolPath(cfg)],
    rule: "exe_features_tool",
    inputs: [join(crate, "main.rs")],
    implicitInputs: [
      ...sources.filter(s => basename(s) !== "main.rs"),
      // make/features.rs compiles it too.
      resolve(cfg.cwd, "src", "bun_core", "feature", "ids.rs"),
      toolIdentityFile(cfg, "hostCc"),
    ],
    vars: { lib: q(join(crate, "lib.rs")) },
  });
}

/** `stripped` with the table of the link in it: the `bun` that ships. */
export function emitFeatureTable(n: Ninja, cfg: Config, stripped: string, out: string): void {
  n.build({
    outputs: [out],
    rule: "feature_table",
    inputs: [stripped],
    implicitInputs: [
      linkTable(cfg),
      toolPath(cfg),
      resolve(cfg.cwd, "src", "codegen", "compress-embed.ts"),
      ...machoPostlinkImplicitInputs(cfg),
    ],
    vars: { table: q(linkTable(cfg)) },
  });
}
