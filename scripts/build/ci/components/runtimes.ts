// Small pinned tools baked onto every image: bun (runs the bake's own
// tooling, not the bun under test), curl-h3 (HTTP/3 test client), the
// buildkite agent binary, and age. Each is a straight download → install
// against the image's root paths.

import { join } from "node:path";
import { ageDownload, buildkiteAgentDownload, bunDownload, bunTriplet, curlH3Download } from "../artifacts.ts";
import { ensureSymlink, extractArchive, installFile, verify } from "../bootstrap/ops-posix.ts";
import * as win from "../bootstrap/ops-windows.ts";
import { download, log, run, runOutput, scratchDir, writeText } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { artifact } from "./component.ts";
import { appendToProfiles } from "./environment.ts";
import { linuxBin, windowsSystem32 } from "./paths.ts";

export const bun: Component = {
  name: "bun",
  linux: {
    artifacts: image => ({ bun: bunDownload(image.bun, "linux", image.arch, image.abi) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install Bun ${image.bun.version}`,
          run: async () => {
            const zip = await download(artifact(ctx.artifacts, "bun"));
            await extractArchive({ file: zip, into: scratchDir });
            const triplet = bunTriplet("linux", image.arch, image.abi);
            await installFile({ from: join(scratchDir, triplet, "bun"), to: linuxBin(image, "bun"), mode: "755" });
            await ensureSymlink(linuxBin(image, "bun"), linuxBin(image, "bunx"));
            await verify("bun --version runs", async () => {
              log(`bun ${await runOutput([linuxBin(image, "bun"), "--version"])} installed`);
            });
          },
        },
      ];
    },
  },
  windows: {
    artifacts: image => ({ bun: bunDownload(image.bun, "windows", image.arch, null) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install Bun ${image.bun.version}`,
          run: async () => {
            const zip = await download(artifact(ctx.artifacts, "bun"), { name: "bun.zip" });
            const extract = join(scratchDir, "bun-extract");
            await win.extractArchive({ file: zip, into: extract });
            // System32 so it survives Sysprep (user-profile PATH is lost).
            const exe = await win.findFile(extract, "bun.exe");
            if (!exe) throw new Error(`bun.exe not found in ${zip}`);
            const dest = windowsSystem32(image, "bun.exe");
            await win.installFile({ from: exe, to: dest });
            await verify("bun.exe --version runs", () => run([dest, "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
};

/** Static curl with nghttp3/ngtcp2, installed as `curl-h3` so nothing else
 * changes behavior. Tests find it via $CURL_HTTP3, then `curl-h3` in PATH. */
export const curlH3: Component = {
  name: "curl-h3",
  linux: {
    artifacts: image => ({ curlH3: curlH3Download(image.curlH3, "linux", image.arch, image.abi) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install curl-h3 ${image.curlH3.version} (HTTP/3 test client)`,
          run: async () => {
            const tarball = await download(artifact(ctx.artifacts, "curlH3"));
            await extractArchive({ file: tarball, into: scratchDir, members: ["curl"] });
            const dest = linuxBin(image, "curl-h3");
            await installFile({ from: join(scratchDir, "curl"), to: dest, mode: "755" });
            await appendToProfiles(ctx, [`export CURL_HTTP3=${dest}`]);
            await verify("curl-h3 --version runs", () => run([dest, "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
  windows: {
    artifacts: image => ({ curlH3: curlH3Download(image.curlH3, "windows", image.arch, null) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install curl-h3 ${image.curlH3.version} (HTTP/3 test client)`,
          run: async () => {
            // The bundled System32 curl.exe has no HTTP/3.
            const tar = await download(artifact(ctx.artifacts, "curlH3"), { name: "curl-h3.tar.xz" });
            const extract = join(scratchDir, "curl-h3");
            await win.extractArchive({ file: tar, into: extract });
            const dest = windowsSystem32(image, "curl-h3.exe");
            await win.installFile({ from: `${extract}\\curl.exe`, to: dest });
            await win.installFile({
              from: `${extract}\\curl-ca-bundle.crt`,
              to: windowsSystem32(image, "curl-ca-bundle.crt"),
            });
            await win.setMachineEnv("CURL_HTTP3", dest);
            await verify("curl-h3 --version runs", () => run([dest, "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
};

/** The buildkite-agent binary (the agent.mjs SERVICE that runs it is
 * installed by machine.mjs / the packer provisioner after bootstrap). */
export const buildkiteAgent: Component = {
  name: "buildkite-agent",
  linux: {
    artifacts: image => ({ buildkiteAgent: buildkiteAgentDownload(image.buildkiteAgent, "linux", image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install buildkite-agent ${image.buildkiteAgent.version}`,
          skip: !ctx.ci && "not a CI image",
          run: async () => {
            const tarball = await download(artifact(ctx.artifacts, "buildkiteAgent"));
            await extractArchive({ file: tarball, into: scratchDir, members: ["buildkite-agent"] });
            const dest = linuxBin(image, "buildkite-agent");
            await installFile({ from: join(scratchDir, "buildkite-agent"), to: dest, mode: "755" });
            await verify("buildkite-agent --version runs", () => run([dest, "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
  windows: {
    artifacts: image => ({ buildkiteAgent: buildkiteAgentDownload(image.buildkiteAgent, "windows", image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      const home = image.paths.buildkiteHome;
      return [
        {
          name: `Install buildkite-agent ${image.buildkiteAgent.version}`,
          skip: !ctx.ci && "not a CI image",
          run: async () => {
            const zip = await download(artifact(ctx.artifacts, "buildkiteAgent"), { name: "buildkite-agent.zip" });
            await win.extractArchive({ file: zip, into: `${home}\\bin` });
            await win.addToMachinePath(`${home}\\bin`);
            await verify("buildkite-agent --version runs", () =>
              run([`${home}\\bin\\buildkite-agent.exe`, "--version"]).then(() => undefined),
            );
            // Environment hook: stable checkout path so ccache is effective.
            // pre-exit hook: log out of Tailscale so ephemeral nodes leave the
            // tailnet immediately instead of after a 30-60 min timeout.
            await writeText(
              `${home}\\hooks\\environment.ps1`,
              `# Buildkite environment hook (generated by scripts/build/ci)\r\n$env:BUILDKITE_BUILD_CHECKOUT_PATH = "${home}\\build"\r\n`,
            );
            await writeText(
              `${home}\\hooks\\pre-exit.ps1`,
              `if (Test-Path "C:\\Program Files\\Tailscale\\tailscale.exe") {\r\n  & "C:\\Program Files\\Tailscale\\tailscale.exe" logout 2>$null\r\n}\r\n`,
            );
          },
        },
      ];
    },
  },
};

/** age(1): small file-encryption tool the tests use. Checksums pinned. */
export const age: Component = {
  name: "age",
  linux: {
    artifacts: image => ({ age: ageDownload(image.age, "linux", image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install age ${image.age.version}`,
          run: async () => {
            const tarball = await download(artifact(ctx.artifacts, "age"));
            await extractArchive({ file: tarball, into: scratchDir, members: ["age/age"] });
            await installFile({ from: join(scratchDir, "age", "age"), to: linuxBin(image, "age"), mode: "755" });
          },
        },
      ];
    },
  },
};
