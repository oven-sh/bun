/**
 * bootstrap_cmds — Apple's `migcom`, the Mach Interface Generator compiler,
 * built as a HOST tool. The WebKit direct build (deps/webkit.ts) runs it when
 * targeting macOS to generate WTF's Mach exception RPC stubs from
 * MachExceptions.defs, the way the fork's Dockerfile.macos does: flex +
 * bison + the host C compiler, against the minimal mach type stubs the fork
 * keeps in macos-cross/ (those only make migcom compile on a non-mac host;
 * everything migcom emits is target-side `sizeof` expressions). Nothing
 * here links into bun.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import type { Ninja } from "../ninja.ts";
import { quoteArgs } from "../shell.ts";
import {
  type CustomBuildContext,
  type CustomBuildResult,
  type Dependency,
  depBuildDir,
  depSourceDir,
} from "../source.ts";

/** apple-oss-distributions/bootstrap_cmds tag bootstrap_cmds-138 (what the fork's Dockerfile.macos pins). */
const BOOTSTRAP_CMDS_COMMIT = "c71d2d72f48995baaea76148f61002e5299841de";

export function migcomPath(cfg: Config): string {
  return join(depBuildDir(cfg, "bootstrap_cmds"), `migcom${cfg.host.exeSuffix}`);
}

export const bootstrapCmds: Dependency = {
  name: "bootstrap_cmds",
  enabled: cfg => cfg.darwin && cfg.host.os !== "darwin" && cfg.webkit === "source",

  source: () => ({ kind: "github", repo: "apple-oss-distributions/bootstrap_cmds", commit: BOOTSTRAP_CMDS_COMMIT }),

  build: () => ({ kind: "custom", emit: emitMigcom }),
  provides: () => ({ libs: [], includes: [] }),
};

function emitMigcom(n: Ninja, cfg: Config, { srcDir, ready }: CustomBuildContext): CustomBuildResult {
  const name = "bootstrap_cmds";
  const hostWin = cfg.host.os === "windows";
  const B = depBuildDir(cfg, "bootstrap_cmds");
  const src = join(srcDir, "migcom.tproj");
  // The stub <mach/*.h> for the host come from the WebKit tree (fetched at
  // configure time like this one — or a --local-deps clone — so the files
  // are on disk before ninja runs; no stamp to wait for).
  const machStubs = join(depSourceDir(cfg, "WebKit"), "macos-cross");
  const orderOnly = ready;

  const lexer = join(B, "lexxer.c");
  const parser = join(B, "parser.c");
  const ytab = join(B, "y.tab.h");
  n.build({
    outputs: [lexer],
    rule: "dep_codegen",
    inputs: [join(src, "lexxer.l")],
    orderOnlyInputs: orderOnly,
    vars: { name, desc: "flex migcom", cmd: quoteArgs(["flex", "-o", lexer, join(src, "lexxer.l")], hostWin) },
  });
  n.build({
    outputs: [parser, ytab],
    rule: "dep_codegen",
    inputs: [join(src, "parser.y")],
    orderOnlyInputs: orderOnly,
    vars: {
      name,
      desc: "bison migcom",
      cmd: quoteArgs(["bison", `--defines=${ytab}`, "-o", parser, join(src, "parser.y")], hostWin),
    },
  });
  const sources = [
    ...["error", "global", "header", "mig", "routine", "server", "statement", "string", "type", "user", "utils"].map(
      f => join(src, `${f}.c`),
    ),
    lexer,
    parser,
  ];
  const migcom = migcomPath(cfg);
  n.build({
    outputs: [migcom],
    rule: "dep_host_cc",
    inputs: sources,
    implicitInputs: [ytab],
    orderOnlyInputs: orderOnly,
    vars: {
      flags: quoteArgs(
        [
          "-O2",
          "-w",
          `-I${src}`,
          `-I${B}`,
          `-I${machStubs}`,
          "-D__private_extern__=",
          "-Ulinux",
          `-DMIG_VERSION="bun"`,
        ],
        hostWin,
      ),
    },
  });
  n.phony("migcom", [migcom]);
  return { objects: [], includes: [], outputs: [migcom] };
}
