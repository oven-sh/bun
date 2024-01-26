import { spawnSync } from "node:child_process";
import { BuildCommand } from "./build-layer";

export class PublishCommand extends BuildCommand {
  static summary = "Publish a custom Lambda layer for Bun.";

  #aws(args: string[]): string {
    this.debug("$", "aws", ...args);
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
    this.debug("Options:", flags);
    try {
      const version = this.#aws(["--version"]);
      this.debug("AWS CLI:", version);
    } catch (error) {
      this.debug(error);
      this.error(
        "Install the `aws` CLI to continue: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
        { exit: 1 },
      );
    }
    const { layer, region, arch, output, public: isPublic } = flags;
    if (region.includes("*")) {
      // biome-ignore: format ignore
      const result = this.#aws(["ec2", "describe-regions", "--query", "Regions[].RegionName", "--output", "json"]);
      region.length = 0;
      for (const name of JSON.parse(result)) {
        region.push(name);
      }
    } else if (!region.length) {
      // biome-ignore: format ignore
      region.push(this.#aws(["configure", "get", "region"]));
    }
    this.log("Publishing...");
    for (const regionName of region) {
      for (const layerName of layer) {
        // biome-ignore: format ignore
        const result = this.#aws([
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
        const { LayerVersionArn } = JSON.parse(result);
        this.log("Published", LayerVersionArn);
        if (isPublic) {
          // biome-ignore: format ignore
          this.#aws([
            "lambda",
            "add-layer-version-permission",
            "--layer-name",
            layerName,
            "--region",
            regionName,
            "--version-number",
            LayerVersionArn.split(":").pop(),
            "--statement-id",
            `${layerName}-public`,
            "--action",
            "lambda:GetLayerVersion",
            "--principal",
            "*",
          ]);
        }
      }
    }
    this.log("Done");
  }
}

await PublishCommand.run(process.argv.slice(2));
