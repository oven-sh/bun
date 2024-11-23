import { Abi, Agent, Arch, Os } from "../agent/Agent";
import { _Platform } from "../platform/Platform.Builder";
import { Target } from "./Target._";

export type _Target<Step> = {
  getTargetKey: () => string;
  getTargetLabel: () => string;
  getBuildToolchain: () => string;
  getBuildAgent: (platform: _Platform<Step>) => Agent;
  getZigAgent: () => Agent;
  getParallelism: () => number;
};

export class TargetBuilder<Step> {
  private os?: Os;
  private arch?: Arch;
  private abi?: Abi;
  private baseline?: boolean;

  static linux<Step>(arch: Arch): TargetBuilder<Step> {
    return new TargetBuilder().setOs("linux").setArch(arch);
  }

  static darwin<Step>(arch: Arch): TargetBuilder<Step> {
    return new TargetBuilder().setOs("darwin").setArch(arch);
  }

  static windows<Step>(arch: Arch): TargetBuilder<Step> {
    return new TargetBuilder().setOs("windows").setArch(arch);
  }

  setArch(arch: Arch): this {
    this.arch = arch;
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

  setOs(os: Os): this {
    this.os = os;
    return this;
  }

  build(): Target & _Target<Step> {
    if (!this.os) {
      throw new Error("os is required");
    }

    if (!this.arch) {
      throw new Error("arch is required");
    }

    let target: Target = {
      os: this.os,
      arch: this.arch,
    };

    if (this.abi) {
      target.abi = this.abi;
    }

    if (this.baseline) {
      target.baseline = this.baseline;
    }

    return {
      ...target,
      getTargetKey: () => Target.getTargetKey(target),
      getTargetLabel: () => Target.getTargetLabel(target),
      getBuildToolchain: () => Target.getBuildToolchain(target),
      getBuildAgent: () => Target.getBuildAgent(target),
      getZigAgent: () => Target.getZigAgent(target),
      getParallelism: () => Target.getParallelism(target),
    };
  }
}
