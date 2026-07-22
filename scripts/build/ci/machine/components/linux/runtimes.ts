// Small pinned tools baked onto every linux image: bun (runs the bake's own
// tooling, not the bun under test), curl-h3 (HTTP/3 test client), the
// buildkite agent binary, and age. Each is a straight download → install
// against the image's root paths. The windows halves are windows/runtimes.ts.

import { join } from "node:path";
import { ageDownload, buildkiteAgentDownload, bunDownload, bunTriplet, curlH3Download } from "../../artifacts.ts";
import { ensureSymlink, extractArchive, installFile } from "../../ops-posix.ts";
import { download, log, run, runOutput, scratchDir, verify } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { appendToProfiles } from "../environment.ts";
import { linuxBin } from "../paths.ts";

export const bun: LinuxComponent = {
  name: "bun",
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
};

/** Static curl with nghttp3/ngtcp2, installed as `curl-h3` so nothing else
 * changes behavior. Tests find it via $CURL_HTTP3, then `curl-h3` in PATH. */
export const curlH3: LinuxComponent = {
  name: "curl-h3",
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
};

/** The buildkite-agent binary (the agent.mjs SERVICE that runs it is
 * installed by machine.ts after bootstrap). */
export const buildkiteAgent: LinuxComponent = {
  name: "buildkite-agent",
  artifacts: image => ({ buildkiteAgent: buildkiteAgentDownload(image.buildkiteAgent, "linux", image.arch) }),
  steps: ctx => {
    const { image } = ctx;
    return [
      {
        name: `Install buildkite-agent ${image.buildkiteAgent.version}`,
        skip: !ctx.ci && "not a CI image",
        run: async () => {
          const tarball = await download(artifact(ctx.artifacts, "buildkiteAgent"));
          // The archive roots its members at "./" (see tar -t), and tar
          // member matching is literal — request it exactly as archived.
          await extractArchive({ file: tarball, into: scratchDir, members: ["./buildkite-agent"] });
          const dest = linuxBin(image, "buildkite-agent");
          await installFile({ from: join(scratchDir, "buildkite-agent"), to: dest, mode: "755" });
          await verify("buildkite-agent --version runs", () => run([dest, "--version"]).then(() => undefined));
        },
      },
    ];
  },
};

/** age(1): small file-encryption tool the tests use. Checksums pinned. */
export const age: LinuxComponent = {
  name: "age",
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
};
