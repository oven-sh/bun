import { getBootstrapVersion, getBuildNumber } from "../../machine/context/process.ts";
import { type Abi, type Agent, type Arch, type Os } from "../agent/Agent.ts";
import { BuildkiteContext, type BuildkiteStep } from "../pipeline/buildkite/BuildkiteContext.ts";
import { Pipeline, type PipelineOptions } from "../pipeline/Pipeline.ts";
import { TargetBuilder } from "../target/TargetBuilder.ts";
import { PlatformBuilder } from "./PlatformBuilder.ts";

export interface Platform {
  os: Os;
  arch: Arch;
  abi?: Abi;
  baseline?: boolean;
  distro?: string;
  release: string;
}

export type PlatformPrototype<Step> = {
  getPlatformKey: () => string;
  getPlatformLabel: () => string;
  getImageKey: () => string;
  getImageLabel: () => string;
  isUsingNewAgent: () => boolean;
  getEphemeralAgent: (version: "v1" | "v2", instance: { image?: string; instanceType: string }) => Agent;
  getTestAgent: () => Agent;
  getBuildAgent: () => Agent;
  getBuildImageStep: () => Step;
  getDependsOn: (step?: string) => string[];
};

export class Platform {
  static getPlatformKey = (platform: Platform, options: PipelineOptions): string => {
    const { os, arch, abi, baseline, distro, release } = platform;
    const target = new TargetBuilder()
      .setOs(os)
      .setArch(arch)
      .setAbi(abi)
      .setBaseline(baseline)
      .setOptions(options)
      .build()
      .getTargetKey();
    if (distro) {
      return `${target}-${distro}-${release.replace(/\./g, "")}`;
    }
    return `${target}-${release.replace(/\./g, "")}`;
  };

  static getPlatformLabel = (platform: Platform): string => {
    const { os, arch, baseline, distro, release } = platform;
    let label = `${BuildkiteContext.getEmoji(distro || os)} ${release} ${arch}`;
    if (baseline) {
      label += "-baseline";
    }
    return label;
  };

  static getImageKey = (platform: Platform): string => {
    const { os, arch, distro, release } = platform;
    if (distro) {
      return `${os}-${arch}-${distro}-${release.replace(/\./g, "")}`;
    }
    return `${os}-${arch}-${release.replace(/\./g, "")}`;
  };

  /**
   * @param {Platform} platform
   * @returns {string}
   */
  static getImageLabel = (platform: Platform): string => {
    const { os, arch, distro, release } = platform;
    return `${BuildkiteContext.getEmoji(distro || os)} ${release} ${arch}`;
  };

  /**
   * @param {Platform} platform
   * @returns {boolean}
   */
  static isUsingNewAgent = (platform: Platform): boolean => {
    const { os } = platform;
    if (os === "linux") {
      return true;
    }
    return false;
  };

  /**
   * @param {"v1" | "v2"} version
   * @param {Platform} platform
   * @param {string} [instanceType]
   * @returns {Agent}
   */
  static getEphemeralAgent = (
    version: "v1" | "v2",
    platform: Platform,
    instanceType: string,
    options: PipelineOptions,
  ): Agent => {
    const { os, arch, abi, distro, release } = platform;
    const { buildImages, publishImages } = options;
    if (version === "v1") {
      return {
        robobun: true,
        os,
        arch,
        distro,
        release,
      };
    }
    let image;
    if (distro) {
      image = `${os}-${arch}-${distro}-${release}`;
    } else {
      image = `${os}-${arch}-${release}`;
    }
    if (buildImages && !publishImages) {
      image += `-build-${getBuildNumber()}`;
    } else {
      image += `-v${getBootstrapVersion()}`;
    }
    return {
      robobun: true,
      robobun2: true,
      os,
      arch,
      abi,
      distro,
      release,
      "image-name": image,
      "instance-type": instanceType,
    };
  };

  /**
   * @param {Platform} platform
   * @returns {Agent}
   */
  static getTestAgent = (platform: Platform, options: PipelineOptions): Agent => {
    const { arch, os, release, isUsingNewAgent, getEphemeralAgent } = new PlatformBuilder()
      .setOs(platform.os)
      .setArch(platform.arch)
      .setRelease(platform.release)
      .setOptions(options)
      .build();

    if (isUsingNewAgent()) {
      const instanceType = arch === "aarch64" ? "t4g.large" : "t3.large";
      return getEphemeralAgent("v2", { instanceType });
    }
    if (os === "darwin") {
      return {
        os,
        arch,
        release,
        queue: "test-darwin",
      };
    }
    return getEphemeralAgent("v1", { instanceType: undefined as unknown as string });
  };

  /**
   * @param {Platform} platform
   * @returns {BuildkiteStep}
   */
  static getBuildImageStep = (platform: Platform, options: PipelineOptions): BuildkiteStep => {
    const { publishImages } = options;
    const { os, arch, distro, release, getImageKey, getImageLabel } = new PlatformBuilder()
      .setOs(platform.os)
      .setArch(platform.arch)
      .setDistro(platform.distro || "")
      .setRelease(platform.release)
      .setOptions(options)
      .build();
    const action = publishImages ? "publish-image" : "create-image";
    return {
      key: `${getImageKey()}-build-image`,
      label: `${getImageLabel()} - build-image`,
      agents: {
        queue: "build-image",
      },
      env: {
        DEBUG: "1",
      },
      retry: Pipeline.getRetry(),
      command: `node ./scripts/machine.mjs ${action} --ci --cloud=aws --os=${os} --arch=${arch} --distro=${distro} --distro-version=${release}`,
    };
  };
}
