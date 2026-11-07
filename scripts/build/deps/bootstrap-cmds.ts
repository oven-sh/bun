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

/** Tag bootstrap_cmds-138, which the fork's Dockerfile.macos pins. */
const BOOTSTRAP_CMDS_COMMIT = "c71d2d72f48995baaea76148f61002e5299841de";

export function migcomPath(cfg: Config): string {
  return join(depBuildDir(cfg, "bootstrap_cmds"), `migcom${cfg.host.exeSuffix}`);
}

export const bootstrapCmds: Dependency = {
  name: "bootstrap_cmds",
  enabled: cfg => cfg.darwin && cfg.host.os !== "darwin" && cfg.webkit !== "prebuilt",

  source: () => ({
    kind: "github-archive",
    repo: "apple-oss-distributions/bootstrap_cmds",
    commit: BOOTSTRAP_CMDS_COMMIT,
  }),

  build: cfg => {
    const B = depBuildDir(cfg, "bootstrap_cmds");
    const src = join(depSourceDir(cfg, "bootstrap_cmds"), "migcom.tproj");
    const handwritten = "error global header mig routine server statement string type user utils";
    const [lexer, parser, tokens] = ["lexxer.c", "parser.c", "y.tab.h"].map(file => join(B, file)) as [
      string,
      string,
      string,
    ];
    return {
      kind: "direct",
      sources: [],
      steps: [
        {
          outputs: [lexer],
          inputs: [join(src, "lexxer.l")],
          cwd: B,
          cmd: ["flex", "-o", lexer, join(src, "lexxer.l")],
          desc: "migcom lexxer.c",
        },
        {
          outputs: [parser, tokens],
          inputs: [join(src, "parser.y")],
          cwd: B,
          cmd: ["bison", `--defines=${tokens}`, "-o", parser, join(src, "parser.y")],
          desc: "migcom parser.c",
        },
        {
          kind: "host-cc",
          output: migcomPath(cfg),
          sources: [...handwritten.split(" ").map(name => join(src, `${name}.c`)), lexer, parser],
          flags: [
            ...["-O1", "-w", `-I${src}`, `-I${B}`, `-I${join(depSourceDir(cfg, "WebKit"), "macos-cross")}`],
            "-D__private_extern__=",
            // A compiler in GNU mode predefines `linux`, and migcom's type.h would then include <linux/types.h>.
            "-Ulinux",
            '-DMIG_VERSION="bun"',
          ],
          inputs: [tokens],
        },
      ],
    };
  },

  provides: () => ({ libs: [], includes: [] }),
};
