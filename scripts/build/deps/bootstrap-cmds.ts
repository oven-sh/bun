/**
 * bootstrap_cmds — Apple's `migcom`, the compiler of the Mach Interface Generator, built to run on this machine.
 * deps/webkit.ts runs it when the target is macOS and the host is not, to generate WTF's Mach exception stubs from
 * MachExceptions.defs, the way the fork's Dockerfile.macos does: flex, bison and the host's C compiler, against the few
 * Mach types the fork keeps in macos-cross/. Those only make migcom compile here: every size in what migcom prints is a
 * `sizeof` that the target's compiler evaluates. Nothing of this is linked into bun.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import { type Dependency, depBuildDir, depSourceDir } from "../source.ts";
import { findSystemTool } from "../tools.ts";

/** Tag bootstrap_cmds-138, which the fork's Dockerfile.macos pins. */
const BOOTSTRAP_CMDS_COMMIT = "c71d2d72f48995baaea76148f61002e5299841de";

export function buildsMigcom(cfg: Config): boolean {
  return cfg.darwin && cfg.host.os !== "darwin" && cfg.webkit !== "prebuilt";
}

export function migcomPath(cfg: Config): string {
  return join(depBuildDir(cfg, "bootstrap_cmds"), `migcom${cfg.host.exeSuffix}`);
}

export const bootstrapCmds: Dependency = {
  name: "bootstrap_cmds",
  enabled: buildsMigcom,

  source: () => ({
    kind: "github-archive",
    repo: "apple-oss-distributions/bootstrap_cmds",
    commit: BOOTSTRAP_CMDS_COMMIT,
  }),

  build: cfg => {
    const B = depBuildDir(cfg, "bootstrap_cmds");
    const src = join(depSourceDir(cfg, "bootstrap_cmds"), "migcom.tproj");
    const hint = "Compiling WebKit for macOS on another system needs flex and bison: apt install flex bison";
    const flex = findSystemTool("flex", { required: true, hint })!;
    const bison = findSystemTool("bison", { required: true, hint })!;
    const handwritten = [
      "error.c",
      "global.c",
      "header.c",
      "mig.c",
      "routine.c",
      "server.c",
      "statement.c",
      "string.c",
      "type.c",
      "user.c",
      "utils.c",
    ].map(f => join(src, f));
    const generated = [join(B, "lexxer.c"), join(B, "parser.c")];
    return {
      kind: "direct",
      sources: [],
      steps: [
        {
          outputs: [join(B, "lexxer.c")],
          inputs: [join(src, "lexxer.l")],
          cwd: B,
          cmd: [flex, "-o", join(B, "lexxer.c"), join(src, "lexxer.l")],
          desc: "migcom lexxer.c",
        },
        {
          outputs: [join(B, "parser.c"), join(B, "y.tab.h")],
          inputs: [join(src, "parser.y")],
          cwd: B,
          cmd: [bison, `--defines=${join(B, "y.tab.h")}`, "-o", join(B, "parser.c"), join(src, "parser.y")],
          desc: "migcom parser.c",
        },
        {
          outputs: [migcomPath(cfg)],
          inputs: [...handwritten, ...generated, join(B, "y.tab.h")],
          cwd: B,
          cmd: [
            cfg.hostCc,
            "-O1",
            "-w",
            `-I${src}`,
            `-I${B}`,
            `-I${join(depSourceDir(cfg, "WebKit"), "macos-cross")}`,
            "-D__private_extern__=",
            // A compiler in GNU mode predefines `linux`, and migcom's type.h would then include <linux/types.h>.
            "-Ulinux",
            '-DMIG_VERSION="bun"',
            "-o",
            migcomPath(cfg),
            ...handwritten,
            ...generated,
          ],
          desc: "migcom",
        },
      ],
    };
  },

  provides: () => ({ libs: [], includes: [] }),
};
