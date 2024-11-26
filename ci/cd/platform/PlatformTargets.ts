import { type PipelineOptions } from "../pipeline/Pipeline.ts";
import { type Platform } from "./Platform.ts";
import { PlatformBuilder } from "./PlatformBuilder.ts";

export class PlatformTargets {
  static buildPlatforms = <Step>(options: PipelineOptions) =>
    (
      [
        { os: "darwin", arch: "aarch64", release: "14" },
        { os: "darwin", arch: "x64", release: "14" },
        { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
        { os: "linux", arch: "x64", distro: "debian", release: "11" },
        { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11" },
        { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
        { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
        { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20" },
        { os: "windows", arch: "x64", release: "2019" },
        { os: "windows", arch: "x64", baseline: true, release: "2019" },
      ] as Platform[]
    ).map(platform =>
      new PlatformBuilder<Step>()
        .setOs(platform.os)
        .setArch(platform.arch)
        .setAbi(platform.abi)
        .setBaseline(platform.baseline || false)
        .setDistro(platform.distro)
        .setRelease(platform.release)
        .setOptions(options)
        .build(),
    );

  static testPlatforms = <Step>(options: PipelineOptions) =>
    (
      [
        { os: "darwin", arch: "aarch64", release: "14" },
        { os: "darwin", arch: "aarch64", release: "13" },
        { os: "darwin", arch: "x64", release: "14" },
        { os: "darwin", arch: "x64", release: "13" },
        { os: "linux", arch: "aarch64", distro: "debian", release: "12" },
        { os: "linux", arch: "aarch64", distro: "debian", release: "11" },
        { os: "linux", arch: "x64", distro: "debian", release: "12" },
        { os: "linux", arch: "x64", distro: "debian", release: "11" },
        { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "12" },
        { os: "linux", arch: "x64", baseline: true, distro: "debian", release: "11" },
        { os: "linux", arch: "aarch64", distro: "ubuntu", release: "22.04" },
        { os: "linux", arch: "aarch64", distro: "ubuntu", release: "20.04" },
        { os: "linux", arch: "x64", distro: "ubuntu", release: "22.04" },
        { os: "linux", arch: "x64", distro: "ubuntu", release: "20.04" },
        { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "22.04" },
        { os: "linux", arch: "x64", baseline: true, distro: "ubuntu", release: "20.04" },
        { os: "linux", arch: "aarch64", abi: "musl", distro: "alpine", release: "3.20" },
        { os: "linux", arch: "x64", abi: "musl", distro: "alpine", release: "3.20" },
        { os: "linux", arch: "x64", abi: "musl", baseline: true, distro: "alpine", release: "3.20" },
        { os: "windows", arch: "x64", release: "2019" },
        { os: "windows", arch: "x64", baseline: true, release: "2019" },
      ] as Platform[]
    ).map(platform =>
      new PlatformBuilder<Step>()
        .setOs(platform.os)
        .setArch(platform.arch)
        .setAbi(platform.abi)
        .setBaseline(platform.baseline || false)
        .setDistro(platform.distro)
        .setRelease(platform.release)
        .setOptions(options)
        .build(),
    );

  static imagePlatforms = <Step>(options: PipelineOptions) =>
    new Map(
      [...PlatformTargets.buildPlatforms(options), ...PlatformTargets.testPlatforms(options)]
        .map(platform =>
          new PlatformBuilder<Step>()
            .setOs(platform.os)
            .setArch(platform.arch)
            .setDistro(platform.distro || "")
            .setRelease(platform.release)
            .setOptions(options)
            .build(),
        )
        .filter(platform => options.buildImages && platform.isUsingNewAgent())
        .map(platform => [platform.getImageKey(), platform]),
    );

  /**
   * @param {Platform} platform
   * @param {string} [step]
   * @returns {string[]}
   */
  static getDependsOn = <Step>(
    platform: Platform,
    step?: string,
    options: PipelineOptions = {
      buildImages: false,
      publishImages: false,
    },
  ): string[] => {
    const imageKey = new PlatformBuilder<Step>()
      .setOs(platform.os)
      .setArch(platform.arch)
      .setDistro(platform.distro || "")
      .setRelease(platform.release)
      .setOptions(options)
      .build()
      .getImageKey();

    if (PlatformTargets.imagePlatforms<Step>(options).has(imageKey)) {
      const key = `${imageKey}-build-image`;
      if (key !== step) {
        return [key];
      }
    }
    return [];
  };
}
