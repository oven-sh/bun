// Node.js on windows: Scoop installs `nodejs@<version>` (see scoop.ts);
// this verifies the version and seeds node-gyp's header cache so napi
// tests never download headers at test time. The linux half is
// nodejs.linux.ts.

import { join } from "node:path";
import { nodejsHeadersDownload, nodejsWinLibDownload } from "../../artifacts.ts";
import * as win from "../../ops-windows.ts";
import { download, log, runOutput, scratchDir, verify, writeText } from "../../runtime.ts";
import type { WindowsComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { nodeGypCache } from "../paths.ts";

export const nodejs: WindowsComponent = {
  name: "nodejs",
  artifacts: image => ({
    nodejsHeaders: nodejsHeadersDownload(image.nodejs),
    nodejsWinLib: nodejsWinLibDownload(image.nodejs, image.arch),
  }),
  steps: ctx => {
    const { image } = ctx;
    return [
      {
        name: `Verify Node.js is ${image.nodejs.version} and seed node-gyp headers`,
        run: async () => {
          await verify(`${image.paths.node} --version prints v${image.nodejs.version}`, async () => {
            const version = await runOutput([image.paths.node, "--version"]);
            if (version !== `v${image.nodejs.version}`) {
              throw new Error(`Scoop installed node ${version}, spec pins v${image.nodejs.version}`);
            }
          });
          // node-gyp on Windows looks under
          // %LOCALAPPDATA%\node-gyp\Cache\<ver>\; seed both SYSTEM's and the
          // buildkite-agent service account's LocalAppData.
          const headers = await download(artifact(ctx.artifacts, "nodejsHeaders"), { name: "node-headers.tar.gz" });
          const lib = await download(artifact(ctx.artifacts, "nodejsWinLib"), { name: "node.lib" });
          const stage = join(scratchDir, "node-headers");
          await win.extractArchive({ file: headers, into: stage, stripComponents: 1 });
          const libArch = image.arch === "aarch64" ? "arm64" : "x64";
          const v = image.nodejs.version;
          const localAppData = process.env.LOCALAPPDATA;
          const bases = [`${image.paths.buildkiteHome}\\AppData\\Local`];
          if (localAppData) bases.push(localAppData);
          for (const base of bases) {
            const cache = nodeGypCache("windows", base, v);
            await win.ensureDirectory(`${cache}\\${libArch}`);
            await win.copyIntoDirectory(`${stage}\\include`, `${cache}\\include`);
            await win.installFile({ from: lib, to: `${cache}\\${libArch}\\node.lib` });
            await writeText(`${cache}\\installVersion`, `${image.nodejs.gypInstallVersion}\r\n`);
          }
          await win.removePaths(stage);
          log("node-gyp caches seeded");
        },
      },
    ];
  },
};
