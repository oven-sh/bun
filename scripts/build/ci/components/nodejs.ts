// Node.js: the runtime the build scripts and the agent run under.
//
// Linux: the pinned release tarball laid over the image roots (bin, lib,
// include, share; npm/npx symlinks resolve into lib/node_modules).
// Windows: Scoop installs `nodejs@<version>` (see scoop.ts); this
// component verifies the version and seeds node-gyp's header cache on
// both platforms so napi tests never download headers at test time.

import { join } from "node:path";
import { nodejsDownload, nodejsFolderName, nodejsHeadersDownload, nodejsWinLibDownload } from "../artifacts.ts";
import {
  copyIntoDirectory,
  ensureDirectory,
  extractArchive,
  setOwnerRecursive,
  verify,
} from "../bootstrap/ops-posix.ts";
import * as win from "../bootstrap/ops-windows.ts";
import { download, log, runOutput, scratchDir, writeText } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { artifact } from "./component.ts";
import { linuxBin, nodeGypCache } from "./paths.ts";

export const nodejs: Component = {
  name: "nodejs",
  linux: {
    artifacts: image => ({
      nodejs: nodejsDownload(image.nodejs, "linux", image.arch, image.abi),
      nodejsHeaders: nodejsHeadersDownload(image.nodejs),
    }),
    steps: ctx => {
      const { image } = ctx;
      const { nodejs: node } = image;
      return [
        {
          name: `Install Node.js ${node.version}`,
          run: async () => {
            const tarball = await download(artifact(ctx.artifacts, "nodejs"));
            await extractArchive({ file: tarball, into: scratchDir });
            const extracted = join(scratchDir, nodejsFolderName(node, "linux", image.arch, image.abi));
            // bin/, lib/, include/, share/ over the image roots; npm/npx
            // are symlinks into ../lib/node_modules.
            await copyIntoDirectory(join(extracted, "bin"), image.paths.bin);
            await copyIntoDirectory(join(extracted, "lib"), join(image.paths.bin, "..", "lib"));
            await copyIntoDirectory(join(extracted, "include"), image.paths.include);
            await copyIntoDirectory(join(extracted, "share"), join(image.paths.bin, "..", "share"));
            await verify(`${linuxBin(image, "node")} --version prints v${node.version}`, async () => {
              const version = await runOutput([linuxBin(image, "node"), "--version"]);
              if (version !== `v${node.version}`) throw new Error(`got "${version}"`);
            });
          },
        },
        {
          name: `Pre-seed Node.js ${node.version} headers for node-gyp`,
          run: async () => {
            // The cache belongs to whoever RUNS the tests: the buildkite user
            // on a CI image, the invoking user otherwise.
            const owner = ctx.ci ? image.paths.buildkiteUser : ctx.host.user;
            const home = ctx.ci ? image.paths.buildkiteHome : ctx.host.home;
            const tarball = await download(artifact(ctx.artifacts, "nodejsHeaders"));
            await extractArchive({ file: tarball, into: scratchDir });
            const extracted = join(scratchDir, `node-v${node.version}`);
            await copyIntoDirectory(join(extracted, "include"), image.paths.include);
            const cache = nodeGypCache("linux", home, node.version);
            const libArch = image.arch === "aarch64" ? "arm64" : "x64";
            await ensureDirectory(join(cache, "lib", libArch));
            await copyIntoDirectory(join(extracted, "include"), join(cache, "include"));
            await writeText(join(cache, "installVersion"), `${node.gypInstallVersion}\n`);
            await setOwnerRecursive(join(home, ".cache"), owner);
          },
        },
      ];
    },
  },
  windows: {
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
  },
};
