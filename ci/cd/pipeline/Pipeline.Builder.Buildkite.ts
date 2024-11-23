import { Platform } from "../platform/Platform._";
import { _Platform, PlatformBuilder } from "../platform/Platform.Builder";
import { Target } from "../target/Target._";
import { _Target, TargetBuilder } from "../target/Target.Builder";
import { Buildkite } from "./buildkite/Buildkite._";
import { BuildkiteStep } from "./buildkite/Buildkite.Step._";
import { BuildkiteStepBuilder } from "./buildkite/Buildkite.Step.Builder";
import { Pipeline } from "./Pipeline._";
import { PipelineOptions } from "./Pipeline.Options._";
import { PipelineTargetSteps } from "./Pipeline.Builder._";
import { isMainBranch, isMergeQueue } from "../../machine/code/Git";

export class BuildkitePipelineTargetSteps implements PipelineTargetSteps<BuildkiteStep> {
  private platform: Platform & _Platform<BuildkiteStep>;
  private target: Target & _Target<BuildkiteStep>;
  private options: PipelineOptions;

  constructor(platform: Platform, options: PipelineOptions) {
    this.platform = new PlatformBuilder<BuildkiteStep>()
      .setOs(platform.os)
      .setArch(platform.arch)
      .setAbi(platform.abi)
      .setBaseline(platform.baseline)
      .setDistro(platform.distro || "")
      .setRelease(platform.release)
      .setOptions(options)
      .build();

    this.target = new TargetBuilder()
      .setOs(platform.os)
      .setArch(platform.arch)
      .setAbi(platform.abi)
      .setBaseline(platform.baseline)
      .build();

    this.options = options;
  }

  getBuildVendorStep = (): BuildkiteStep => {
    return new BuildkiteStepBuilder(
      `${this.platform.getPlatformKey()}-build-vendor`,
      "bun run build:ci --target dependencies",
    )
      .setLabel(`${this.platform.getPlatformLabel()} - build-vendor`)
      .setAgents(this.platform.getBuildAgent())
      .setRetry(Pipeline.getRetry())
      .setCancelOnBuildFailing(isMergeQueue())
      .setEnv(Buildkite.getBuildEnv(this.platform))
      .setDependsOn(this.platform.getDependsOn())
      .build();
  };

  getBuildCppStep = (): BuildkiteStep => {
    return new BuildkiteStepBuilder(`${this.platform.getPlatformKey()}-build-cpp`, "bun run build:ci --target bun")
      .setLabel(`${this.platform.getPlatformLabel()} - build-cpp`)
      .setAgents(this.platform.getBuildAgent())
      .setRetry(Pipeline.getRetry())
      .setCancelOnBuildFailing(isMergeQueue())
      .setEnv({
        BUN_CPP_ONLY: "ON",
        ...Buildkite.getBuildEnv(this.platform),
      })
      .setDependsOn(this.platform.getDependsOn())
      .build();
  };

  getBuildZigStep = (): BuildkiteStep => {
    const toolchain = this.target.getBuildToolchain();
    return new BuildkiteStepBuilder(
      `${this.platform.getPlatformKey()}-build-zig`,
      `bun run build:ci --target bun-zig --toolchain ${toolchain}`,
    )
      .setLabel(`${this.platform.getPlatformLabel()} - build-zig`)
      .setAgents(this.target.getZigAgent())
      .setRetry(Pipeline.getRetry(1)) // FIXME: Sometimes zig build hangs, so we need to retry once
      .setCancelOnBuildFailing(isMergeQueue())
      .setEnv(Buildkite.getBuildEnv(this.platform))
      .setDependsOn(this.platform.getDependsOn())
      .build();
  };

  getBuildBunStep = (): BuildkiteStep => {
    return new BuildkiteStepBuilder(`${this.platform.getPlatformKey()}-build-bun`, "bun run build:ci --target bun")
      .setLabel(`${this.platform.getPlatformLabel()} - build-bun`)
      .setDependsOn([
        `${this.platform.getPlatformKey()}-build-vendor`,
        `${this.platform.getPlatformKey()}-build-cpp`,
        `${this.platform.getPlatformKey()}-build-zig`,
      ])
      .setAgents(this.platform.getBuildAgent())
      .setRetry(Pipeline.getRetry())
      .setCancelOnBuildFailing(isMergeQueue())
      .setEnv({
        BUN_LINK_ONLY: "ON",
        ...Buildkite.getBuildEnv(this.platform),
      })
      .build();
  };

  getTestBunStep = (): BuildkiteStep => {
    return new BuildkiteStepBuilder(
      `${this.platform.getPlatformKey()}-test-bun`,
      `./scripts/runner.node.mjs --step ${this.platform.getPlatformKey()}-build-bun`,
    )
      .setLabel(`${this.platform.getPlatformLabel()} - test-bun`)
      .setDependsOn([...this.platform.getDependsOn(`${this.platform.getPlatformKey()}-test-bun`)])
      .setAgents(this.platform.getTestAgent())
      .setRetry(Pipeline.getRetry(1))
      .setCancelOnBuildFailing(isMergeQueue())
      .setSoftFail(isMainBranch() ? true : [{ exit_status: 2 }])
      .setParallelism(this.target.getParallelism())
      .setEnv(this.options.buildId ? { BUILDKITE_ARTIFACT_BUILD_ID: this.options.buildId } : {})
      .build();
  };
}
