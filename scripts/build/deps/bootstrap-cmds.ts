/**
 * bootstrap_cmds — Apple's `migcom`, the Mach Interface Generator compiler,
 * built as a HOST tool. The WebKit build (deps/webkit.ts) runs it when
 * targeting macOS from another OS to generate WTF's Mach exception RPC stubs
 * from MachExceptions.defs, the way the fork's Dockerfile.macos does: flex +
 * bison + the host C compiler, against the minimal mach type stubs the fork
 * keeps in macos-cross/ (those only make migcom compile on a non-mac host;
 * everything migcom emits is target-side `sizeof` expressions). Nothing
 * here links into bun.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import { type Dependency, depBuildDir, depSourceDir, depSourceStamp } from "../source.ts";

/** apple-oss-distributions/bootstrap_cmds tag bootstrap_cmds-138 (what the fork's Dockerfile.macos pins). */
const BOOTSTRAP_CMDS_COMMIT = "c71d2d72f48995baaea76148f61002e5299841de";

export function migcomPath(cfg: Config): string {
  return join(depBuildDir(cfg, "bootstrap_cmds"), `migcom${cfg.host.exeSuffix}`);
}

export const bootstrapCmds: Dependency = {
  name: "bootstrap_cmds",
  enabled: cfg => cfg.darwin && cfg.host.os !== "darwin" && cfg.webkit === "source",

  source: () => ({ kind: "github", repo: "apple-oss-distributions/bootstrap_cmds", commit: BOOTSTRAP_CMDS_COMMIT }),

  build: cfg => {
    const B = depBuildDir(cfg, "bootstrap_cmds");
    const src = join(depSourceDir(cfg, "bootstrap_cmds"), "migcom.tproj");
    // The stub <mach/*.h> for the host come from the WebKit tree, so the
    // compile waits for WebKit's fetch.
    const machStubs = join(depSourceDir(cfg, "WebKit"), "macos-cross");
    const webkitTree = depSourceStamp(cfg, "WebKit");
    return {
      kind: "direct",
      sources: [],
      steps: [
        {
          outputs: ["lexxer.c"],
          inputs: ["migcom.tproj/lexxer.l"],
          cmd: ["flex", "-o", join(B, "lexxer.c"), join(src, "lexxer.l")],
        },
        {
          outputs: ["parser.c", "y.tab.h"],
          inputs: ["migcom.tproj/parser.y"],
          cmd: ["bison", `--defines=${join(B, "y.tab.h")}`, "-o", join(B, "parser.c"), join(src, "parser.y")],
        },
        {
          kind: "host-exe",
          output: "migcom",
          sources: [
            ...[
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
            ].map(f => join(src, f)),
            join(B, "lexxer.c"),
            join(B, "parser.c"),
          ],
          implicitInputs: ["y.tab.h", ...(webkitTree !== undefined ? [webkitTree] : [])],
          flags: [
            "-O2",
            "-w",
            `-I${src}`,
            `-I${B}`,
            `-I${machStubs}`,
            "-D__private_extern__=",
            // GNU-mode compilers predefine `linux`; migcom's type.h would then
            // include <linux/types.h> instead of the mach type headers.
            "-Ulinux",
            `-DMIG_VERSION="bun"`,
          ],
        },
      ],
      // WebKit's MIG step (a fetchDeps consumer) waits on the tool itself.
      consumerOutputs: [migcomPath(cfg)],
    };
  },
  provides: () => ({ libs: [], includes: [] }),
};
