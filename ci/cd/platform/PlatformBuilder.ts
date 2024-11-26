import { type Abi, type Arch, type Os } from "../agent/Agent.ts";
import { type PipelineOptions } from "../pipeline/Pipeline.ts";
import { Target } from "../target/Target.ts";
import { Platform, type PlatformPrototype } from "./Platform.ts";
import { PlatformTargets } from "./PlatformTargets.ts";

export class PlatformBuilder<Step> {
  private os?: Os;
  private arch?: Arch;
  private abi?: Abi | undefined;
  private baseline?: boolean;
  private distro?: string;
  private release?: string;
  private options?: PipelineOptions;

  setArch(arch: Arch): this {
    this.arch = arch;
    return this;
  }

  setOs(os: Os): this {
    this.os = os;
    return this;
  }

  setRelease(release: string): this {
    this.release = release;
    return this;
  }

  setAbi(abi?: Abi): this {
    this.abi = abi;
    return this;
  }

  setBaseline(baseline?: boolean): this {
    this.baseline = baseline;
    return this;
  }

  setDistro(distro?: string): this {
    this.distro = distro;
    return this;
  }

  setOptions(options: PipelineOptions): this {
    this.options = options;
    return this;
  }

  build(): Platform & PlatformPrototype<Step> {
    if (!this.os) {
      throw new Error("os is required");
    }

    if (!this.arch) {
      throw new Error("arch is required");
    }

    if (!this.options) {
      throw new Error("options required");
    }

    let platform: Platform = {
      os: this.os,
      arch: this.arch,
      release: this.release ?? "unknown",
    };

    if (this.abi) {
      platform.abi = this.abi;
    }

    if (this.baseline) {
      platform.baseline = this.baseline;
    }

    if (this.distro) {
      platform.distro = this.distro;
    }

    return {
      ...platform,
      getPlatformKey: () => Platform.getPlatformKey(platform, this.options!),
      getPlatformLabel: () => Platform.getPlatformLabel(platform),
      getImageKey: () => Platform.getImageKey(platform),
      getImageLabel: () => Platform.getImageLabel(platform),
      isUsingNewAgent: () => Platform.isUsingNewAgent(platform),
      getEmphemeralAgent: (version: "v1" | "v2", instance: { image?: string; instanceType: string }) =>
        Platform.getEmphemeralAgent(version, platform, instance, this.options!),
      getTestAgent: () => Platform.getTestAgent(platform, this.options!),
      getBuildImageStep: () => Platform.getBuildImageStep(platform, this.options!) as Step,
      getDependsOn: (step?: string) => PlatformTargets.getDependsOn(platform, step, this.options),
      getBuildAgent: () => Target.getBuildAgent(platform, this.options!),
    };
  }
}
