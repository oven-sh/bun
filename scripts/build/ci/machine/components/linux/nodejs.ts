// Node.js on linux: the pinned release tarball laid over the image roots
// (bin, lib, include, share; npm/npx symlinks resolve into
// lib/node_modules), plus the node-gyp header cache so napi tests never
// download headers at test time. The windows half is windows/nodejs.ts.

import { join } from "node:path";
import { nodejsDownload, nodejsFolderName, nodejsHeadersDownload } from "../../artifacts.ts";
import { copyIntoDirectory, ensureDirectory, extractArchive, setOwnerRecursive } from "../../ops-posix.ts";
import { download, runOutput, scratchDir, verify, writeText } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { linuxBin, nodeGypCache } from "../paths.ts";

export const nodejs: LinuxComponent = {
  name: "nodejs",
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
          // bin/, lib/, include/, share/ over the image roots; npm/npx are
          // symlinks into ../lib/node_modules.
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
          // The cache belongs to whoever RUNS the tests: the buildkite user on
          // a CI image, the invoking user otherwise.
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
};
