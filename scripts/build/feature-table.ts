/**
 * The feature table: what lets `bun build --compile --compile-exclude-features` leave parts of the runtime out of an
 * executable (src/exe_features, src/bun_core/feature.rs). `cfg.featureTable` says whether this build has one.
 *
 * The table says which bytes of the executable only which features need. That takes knowing what refers to what, which
 * only the link knows. So the link is made with a few more flags (flags.ts), for the linker to leave that behind, and the
 * link command goes on with `bun-exe-features table`, which writes the table into the executable, which has room for it.
 * `bun` is stripped from that like from any other.
 *
 * An executable is loaded in pages, so what is left out of one is whole pages. For that to be nearly all of what a feature
 * needs, it has to lie together. So the link is made twice: `bun-exe-features order` adds to the order file what the first
 * one shows each set of features to need, and the second lays it out so. LTO's work is cached from the first, so the second
 * takes seconds. The order is a wish: the table is made from what the second link did, whatever that is.
 *
 * `bun-exe-features`, the host tool, is src/exe_features compiled for the machine that builds: what reads the table in
 * `bun build --compile` and what writes it are the same crate.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { bunExeName, type Config } from "./config.ts";
import { featureTableLtoCache, linkedOrderFilePath, linkerMapPath, orderFilePath, usesOrderFile } from "./flags.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";
import { toolIdentityFile } from "./tools.ts";

const q = (p: string) => quote(p, false);
const directory = (cfg: Config) => resolve(cfg.buildDir, "feature-table");
const toolPath = (cfg: Config) => join(directory(cfg), "bun-exe-features");
/** What the linker prints and writes nowhere else: ld.lld what identical code folding merged, lld-link which libraries it read. */
const printed = (cfg: Config) => (cfg.darwin ? "/dev/null" : join(directory(cfg), `${bunExeName(cfg)}.printed`));

/** `link`, the command that links, keeping what the linker prints. */
function keepingWhatTheLinkerPrints(cfg: Config, link: string): string {
  if (cfg.darwin) return link;
  if (!cfg.windows) return `${link} > ${q(printed(cfg))}`;
  // lld-link logs to where its errors and warnings go. Those are still shown.
  const show = `awk '!/^lld-link: / || /^lld-link: (error|warning):/' ${q(printed(cfg))} >&2`;
  return `if ${link} > ${q(printed(cfg))} 2>&1; then ${show}; else ${show}; exit 1; fi`;
}

/** `link`, the command that links `$out`, and then the table. */
export function withFeatureTable(cfg: Config, link: string): string {
  if (!cfg.featureTable) return link;
  const [tool, cache, order] = [toolPath(cfg), featureTableLtoCache(cfg), linkedOrderFilePath(cfg)].map(q);
  const linked = `$out ${q(linkerMapPath(cfg))} ${q(printed(cfg))} ${cache}`;
  const table = `${tool} table ${linked} > ${q(join(directory(cfg), `${bunExeName(cfg)}.report`))}`;
  link = keepingWhatTheLinkerPrints(cfg, link);
  const before = q(usesOrderFile(cfg) ? orderFilePath(cfg) : "/dev/null");
  return (
    `rm -rf ${cache} && cp ${before} ${order} && ${link} && ` +
    `${tool} order ${linked} ${before} ${order} && ${link} && ${table} && rm -rf ${cache}`
  );
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
