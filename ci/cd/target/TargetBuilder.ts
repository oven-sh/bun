import { type Abi, type Arch, type Os } from "../agent/Agent.ts";
import { type PipelineOptions } from "../pipeline/Pipeline.ts";
import { Target, type TargetPrototype } from "./Target.ts";

export class TargetBuilder<Step> {
  private os?: Os;
  private arch?: Arch;
  private abi?: Abi;
  private baseline?: boolean;
  private options?: PipelineOptions;

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

  setOptions(options: PipelineOptions) {
    this.options = options;
    return this;
  }

  build(): Target & TargetPrototype<Step> {
    if (!this.os) {
      throw new Error("os is required");
    }

    if (!this.arch) {
      throw new Error("arch is required");
    }

    if (this.options === undefined) {
      throw new Error("options required");
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
      getBuildAgent: () => Target.getBuildAgent(target, this.options!),
      getZigAgent: () => Target.getZigAgent(target, this.options!),
      getParallelism: () => Target.getParallelism(target),
    };
  }
}
