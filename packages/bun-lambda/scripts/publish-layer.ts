import { Flags } from "@oclif/core";
import { spawnSync } from "node:child_process";
import { BuildCommand } from "./build-layer";

export class PublishCommand extends BuildCommand {
  static summary = "Publish a custom Lambda layer for Bun.";

  static flags = {
    ...BuildCommand.flags,
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

  #aws(args: string[]): string {
    this.log("$", "aws", ...args);
    const { status, stdout, stderr } = spawnSync("aws", args, {
      stdio: "pipe",
    });
    const result = stdout.toString("utf-8").trim();
    if (status === 0) {
      return result;
    }
    const reason = stderr.toString("utf-8").trim() || result;
    throw new Error(`aws ${args.join(" ")} exited with ${status}: ${reason}`);
  }

  async run() {
    const { flags } = await this.parse(PublishCommand);
    this.log("Options:", flags);
    try {
      const version = this.#aws(["--version"]);
      this.log("AWS CLI:", version);
    } catch (error) {
      this.debug(error);
      this.error(
        "Please install the `aws` CLI to continue: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
        { exit: 1 },
      );
    }
    const { layer, region, arch, output } = flags;
    if (!region.length) {
      region.push(this.#aws(["configure", "get", "region"]));
    }
    this.log("Publishing...");
    for (const regionName of region) {
      for (const layerName of layer) {
        this.#aws([
          "lambda",
          "publish-layer-version",
          "--layer-name",
          layerName,
          "--region",
          regionName,
          "--description",
          "Bun is an incredibly fast JavaScript runtime, bundler, transpiler, and package manager.",
          "--license-info",
          "MIT",
          "--compatible-architectures",
          arch === "x64" ? "x86_64" : "arm64",
          "--compatible-runtimes",
          "provided.al2",
          "provided",
          "--zip-file",
          `fileb://${output}`,
          "--output",
          "json",
        ]);
      }
    }
    this.log("Done");
  }
}

await PublishCommand.run(process.argv.slice(2));
