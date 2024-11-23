import { Abi, Agent, Arch, Os } from "../agent/Agent";
import { Buildkite } from "../pipeline/buildkite/Buildkite._";
import { PlatformBuilder } from "../platform/Platform.Builder";

export interface Target {
  os: Os;
  arch: Arch;
  abi?: Abi | undefined;
  baseline?: boolean;
}

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
    let label = `${Buildkite.getEmoji(os)} ${arch}`;
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
  static getBuildAgent = (target: Target): Agent => {
    const { os, arch, abi } = target;
    const platform = (() =>
      (abi ? new PlatformBuilder().setAbi(abi) : new PlatformBuilder()).setOs(os).setArch(arch))().build();

    if (platform.isUsingNewAgent()) {
      const instanceType = arch === "aarch64" ? "c8g.8xlarge" : "c7i.8xlarge";
      return platform.getEmphemeralAgent("v2", instanceType);
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
  static getZigAgent = (target: Target): Agent => {
    const { abi, arch } = target;
    // if (abi === "musl") {
    //   const instanceType = arch === "aarch64" ? "c8g.large" : "c7i.large";
    //   return getEmphemeralAgent("v2", target, instanceType);
    // }
    return {
      queue: "build-zig",
    };
  };

  static getParallelism = (target: Target): number => {
    const { os } = target;
    if (os === "darwin") {
      return 2;
    }
    return 10;
  };
}
