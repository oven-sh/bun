import { type Abi, type Agent, type Arch, type Os } from "../agent/Agent.ts";
import { BuildkiteContext } from "../pipeline/buildkite/BuildkiteContext.ts";
import { type PipelineOptions } from "../pipeline/Pipeline.ts";
import { type PlatformPrototype } from "../platform/Platform.ts";
import { PlatformBuilder } from "../platform/PlatformBuilder.ts";

export interface Target {
  os: Os;
  arch: Arch;
  abi?: Abi | undefined;
  baseline?: boolean;
}

export type TargetPrototype<Step> = {
  getTargetKey: () => string;
  getTargetLabel: () => string;
  getBuildToolchain: () => string;
  getBuildAgent: (platform: PlatformPrototype<Step>) => Agent;
  getZigAgent: () => Agent;
  getParallelism: () => number;
};

export class Target {
  static getTargetKey = (target: Target): string => {
    const { os, arch, abi, baseline } = target;
    let key = `${os}-${arch}`;
    if (abi) {
      key += `-${abi}`;
    }
    if (baseline) {
      key += "-baseline";
    }
    return key;
  };

  static getTargetLabel = (target: Target): string => {
    const { os, arch, abi, baseline } = target;
    let label = `${BuildkiteContext.getEmoji(os)} ${arch}`;
    if (abi) {
      label += `-${abi}`;
    }
    if (baseline) {
      label += "-baseline";
    }
    return label;
  };

  /**
   * @param {Target} target
   * @returns {string}
   */
  static getBuildToolchain = (target: Target): string => {
    const { os, arch, abi, baseline } = target;
    let key = `${os}-${arch}`;
    if (abi) {
      key += `-${abi}`;
    }
    if (baseline) {
      key += "-baseline";
    }
    return key;
  };

  /**
   * @param {Target} target
   * @returns {Agent}
   */
  static getBuildAgent = (target: Target, options: PipelineOptions): Agent => {
    const { os, arch, abi } = target;
    const platform = (abi ? new PlatformBuilder().setAbi(abi) : new PlatformBuilder())
      .setOs(os)
      .setArch(arch)
      .setOptions(options)
      .build();

    if (platform.isUsingNewAgent()) {
      const instanceType = arch === "aarch64" ? "c8g.8xlarge" : "c7i.8xlarge";
      return platform.getEphemeralAgent("v2", { instanceType });
    }
    return {
      queue: `build-${os}`,
      os,
      arch,
      abi,
    };
  };

  /**
   * @param {Target} target
   * @returns {Agent}
   */

  static getZigAgent = (target: Target, options: PipelineOptions): Agent => {
    const { arch } = target;
    const instanceType = arch === "aarch64" ? "c8g.2xlarge" : "c7i.2xlarge";
    const image = `linux-${arch}-debian-11-v5`;
    const platform = new PlatformBuilder()
      .setOs("linux")
      .setDistro("debian")
      .setRelease("11")
      .setArch(arch)
      .setOptions(options)
      .build();

    return platform.getEphemeralAgent("v2", {
      instanceType,
      image,
    });
    // TODO: Temporarily disable due to configuration
    // return {
    //   queue: "build-zig",
    // };
  };

  static getParallelism = (target: Target): number => {
    const { os } = target;
    if (os === "darwin") {
      return 2;
    }
    return 10;
  };
}
