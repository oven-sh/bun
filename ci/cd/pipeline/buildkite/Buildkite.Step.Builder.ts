import { Agent } from "../../agent/Agent";
import { BuildkiteStep } from "./Buildkite.Step._";

export class BuildkiteStepBuilder {
  private key: string;
  private label?: string;
  private agents?: Agent;
  private env?: Record<string, string | undefined>;
  private command?: string;
  private depends_on?: string[];
  private retry?: BuildkiteStep["retry"];
  private cancel_on_build_failing?: boolean;
  private soft_fail?: boolean | Record<string, number>[];
  private parallelism?: number;
  private concurrency?: number;
  private concurrency_group?: string;
  private priority?: number;
  private timeout_in_minutes?: number;
  private group?: string;
  private steps?: BuildkiteStep[];

  constructor(key: string, command?: string) {
    this.key = key;
    this.command = command;
  }

  setKey(key: string): this {
    this.key = key;
    return this;
  }

  setLabel(label: string): this {
    this.label = label;
    return this;
  }

  setAgents(agents: Agent): this {
    this.agents = agents;
    return this;
  }

  setEnv(env: Record<string, string | undefined>): this {
    this.env = env;
    return this;
  }

  setDependsOn(depends_on: string[]): this {
    this.depends_on = depends_on;
    return this;
  }

  setRetry(retry: BuildkiteStep["retry"]): this {
    this.retry = retry;
    return this;
  }

  setCancelOnBuildFailing(cancel_on_build_failing: boolean): this {
    this.cancel_on_build_failing = cancel_on_build_failing;
    return this;
  }

  setSoftFail(soft_fail: boolean | Record<string, number>[]): this {
    this.soft_fail = soft_fail;
    return this;
  }

  setParallelism(parallelism: number): this {
    this.parallelism = parallelism;
    return this;
  }

  setConcurrency(concurrency: number): this {
    this.concurrency = concurrency;
    return this;
  }

  setConcurrencyGroup(concurrency_group: string): this {
    this.concurrency_group = concurrency_group;
    return this;
  }

  setPriority(priority: number): this {
    this.priority = priority;
    return this;
  }

  setTimeoutInMinutes(timeout_in_minutes: number): this {
    this.timeout_in_minutes = timeout_in_minutes;
    return this;
  }

  setGroup(group: string): this {
    this.group = group;
    return this;
  }

  setCommand(command: string): this {
    this.command = command;
    return this;
  }

  setSteps(steps: BuildkiteStep[]): this {
    this.command = undefined;
    this.steps = steps;
    return this;
  }

  build(): BuildkiteStep {
    return {
      key: this.key,
      label: this.label,
      agents: this.agents,
      env: this.env,
      command: this.command,
      depends_on: this.depends_on,
      retry: this.retry,
      cancel_on_build_failing: this.cancel_on_build_failing,
      soft_fail: this.soft_fail,
      parallelism: this.parallelism,
      concurrency: this.concurrency,
      concurrency_group: this.concurrency_group,
      priority: this.priority,
      timeout_in_minutes: this.timeout_in_minutes,
      group: this.group,
      steps: this.steps,
    };
  }
}
