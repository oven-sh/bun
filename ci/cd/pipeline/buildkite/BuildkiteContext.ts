import { isFork, isMainBranch, isMergeQueue } from "../../../machine/code/git.ts";
import { type Agent } from "../../agent/Agent.ts";
import { type Target } from "../../target/Target.ts";

export class BuildkiteContext {
  /**
   * @returns {number}
   * @link https://buildkite.com/docs/pipelines/managing-priorities
   */
  static getPriority = (): number => {
    if (isFork()) {
      return -1;
    }
    if (isMainBranch()) {
      return 2;
    }
    if (isMergeQueue()) {
      return 1;
    }
    return 0;
  };

  /**
   * @param {Target} target
   * @returns {Record<string, string | undefined>}
   */
  static getBuildEnv = (target: Target): Record<string, string | undefined> => {
    const { baseline, abi } = target;
    return {
      ENABLE_BASELINE: baseline ? "ON" : "OFF",
      ABI: abi === "musl" ? "musl" : undefined,
    };
  };

  /**
   * @param {string} text
   * @returns {string}
   * @link https://github.com/buildkite/emojis#emoji-reference
   */
  static getEmoji = (text: string): string => {
    if (text === "amazonlinux") {
      return ":aws:";
    }
    return `:${text}:`;
  };
}
/**
 * @link https://buildkite.com/docs/pipelines/command-step
 */

export type BuildkiteStep = {
  key: string;
  label?: string;
  agents?: Agent;
  env?: Record<string, string | undefined>;
  command?: string;
  depends_on?: string[];
  retry?: {
    automatic: Array<{
      exit_status?: number | undefined;
      limit: number;
      signal_reason?: string | undefined;
    }>;
  };
  cancel_on_build_failing?: boolean;
  soft_fail?: boolean | Record<string, number>[];
  parallelism?: number;
  concurrency?: number;
  concurrency_group?: string;
  priority?: number;
  timeout_in_minutes?: number;
  group?: string;
  steps?: BuildkiteStep[];
};
