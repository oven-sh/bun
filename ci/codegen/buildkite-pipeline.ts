import { BuildkiteContext, type BuildkiteStep } from "../cd/pipeline/buildkite/BuildkiteContext.ts";
import { BuildkitePipelineTargetSteps } from "../cd/pipeline/buildkite/BuildkitePipelineTargetSteps.ts";
import { BuildkiteStepBuilder } from "../cd/pipeline/buildkite/BuildkiteStepBuilder.ts";
import { type PipelineOptions } from "../cd/pipeline/Pipeline.ts";
import { PlatformTargets } from "../cd/platform/PlatformTargets.ts";
import { TargetBuilder } from "../cd/target/TargetBuilder.ts";
import { isFork, isMainBranch } from "../machine/code/git.ts";

/**
 * Build and test Bun on macOS, Linux, and Windows.
 * @link https://buildkite.com/docs/pipelines/defining-steps
 */
export function generateBuildkitePipeline(options: PipelineOptions) {
  const { buildId, buildImages, skipTests } = options;

  const steps: BuildkiteStep[] = [];
  const imagePlatforms = PlatformTargets.imagePlatforms<BuildkiteStep>(options);
  if (imagePlatforms.size) {
    steps.push(
      new BuildkiteStepBuilder(
        ":docker:",
        [...imagePlatforms.values()]
          .map(platform => platform.getBuildImageStep())
          .map(step => step.command)
          .join("\n"),
      ).build(),
    );
  }

  const buildPlatforms = PlatformTargets.buildPlatforms<BuildkiteStep>(options);
  for (const platform of buildPlatforms) {
    const { os, arch, abi, baseline } = platform;
    const { getTargetKey, getTargetLabel } = new TargetBuilder<BuildkiteStep>()
      .setOs(os)
      .setArch(arch)
      .setAbi(abi)
      .setBaseline(baseline)
      .setOptions(options)
      .build();

    const platformSteps: BuildkiteStep[] = [];
    const { getBuildVendorStep, getBuildCppStep, getBuildZigStep, getBuildBunStep } = new BuildkitePipelineTargetSteps(
      platform,
      options,
    );

    if (buildImages || !buildId) {
      platformSteps.push(getBuildVendorStep(), getBuildCppStep(), getBuildZigStep(), getBuildBunStep());
    }

    if (!skipTests) {
      platformSteps.push(
        ...PlatformTargets.testPlatforms<BuildkiteStep>(options)
          .filter(
            testPlatform =>
              testPlatform.os === os &&
              testPlatform.arch === arch &&
              testPlatform.abi === abi &&
              testPlatform.baseline === baseline,
          )
          .map(testPlatform => new BuildkitePipelineTargetSteps(testPlatform, options).getTestBunStep()),
      );
    }

    if (!platformSteps.length) {
      continue;
    }

    steps.push(new BuildkiteStepBuilder(getTargetKey(), getTargetLabel()).setSteps(platformSteps).build());

    if (isMainBranch() && !isFork()) {
      steps.push(
        new BuildkiteStepBuilder(":github:", ".buildkite/scripts/upload-release.sh")
          .setAgents({
            queue: "test-darwin",
          })
          .setDependsOn(
            PlatformTargets.buildPlatforms<BuildkiteStep>(options).map(platform => {
              const target = new TargetBuilder<BuildkiteStep>()
                .setOs(platform.os)
                .setArch(platform.arch)
                .setAbi(platform.abi)
                .setBaseline(platform.baseline)
                .build();
              return `${target.getTargetKey()}-build-bun`;
            }),
          )
          .build(),
      );
    }

    return {
      priority: BuildkiteContext.getPriority(),
      steps,
    };
  }
}
