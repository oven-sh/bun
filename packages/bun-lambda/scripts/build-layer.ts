// HACK: https://github.com/oven-sh/bun/issues/2081
process.stdout.getWindowSize = () => [80, 80];
process.stderr.getWindowSize = () => [80, 80];

import { createReadStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Flags } from "@oclif/core";
import JSZip from "jszip";

export class BuildCommand extends Command {
  static summary = "Build a custom Lambda layer for Bun.";

  static flags = {
    arch: Flags.string({
      description: "The architecture type to support.",
      options: ["x64", "aarch64"],
      default: "aarch64",
    }),
    release: Flags.string({
      description: "The release of Bun to install.",
      default: "latest",
    }),
    url: Flags.string({
      description: "A custom URL to download Bun.",
      exclusive: ["release"],
    }),
    output: Flags.file({
      exists: false,
      default: async () => "bun-lambda-layer.zip",
    }),
    layer: Flags.string({
      description: "The name of the Lambda layer.",
      multiple: true,
      default: ["bun"],
    }),
    region: Flags.string({
      description: "The region to publish the layer.",
      multiple: true,
      default: [],
    }),
    public: Flags.boolean({
      description: "If the layer should be public.",
      default: false,
    }),
  };

  async run() {
    const result = await this.parse(BuildCommand);
    const { flags } = result;
    this.debug("Options:", flags);
    const { arch, release, url, output } = flags;
    const { href } = new URL(url ?? `https://bun.sh/download/${release}/linux/${arch}?avx2=true`);
    this.log("Downloading...", href);
    const response = await fetch(href, {
      headers: {
        "User-Agent": "bun-lambda",
      },
    });
    if (response.url !== href) {
      this.debug("Redirected URL:", response.url);
    }
    this.debug("Response:", response.status, response.statusText);
    if (!response.ok) {
      const reason = await response.text();
      this.error(reason, { exit: 1 });
    }
    this.log("Extracting...");
    const buffer = await response.arrayBuffer();
    let archive;
    try {
      archive = await JSZip.loadAsync(buffer);
    } catch (cause) {
      this.debug(cause);
      this.error("Failed to unzip file:", { exit: 1 });
    }
    this.debug("Extracted archive:", Object.keys(archive.files));
    const bun = archive.filter((_, { dir, name }) => !dir && name.endsWith("bun"))[0];
    if (!bun) {
      this.error("Failed to find executable in zip", { exit: 1 });
    }
    const cwd = bun.name.split("/")[0];
    archive = archive.folder(cwd) ?? archive;
    for (const filename of ["bootstrap", "runtime.ts"]) {
      const path = join(__dirname, "..", filename);
      archive.file(filename, createReadStream(path));
    }
    this.log("Saving...", output);
    const archiveBuffer = await archive
      .generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 9,
        },
      })
      .then(blob => blob.arrayBuffer());
    writeFileSync(output, archiveBuffer);
    this.log("Saved");
  }
}

await BuildCommand.run(process.argv.slice(2));
