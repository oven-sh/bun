import { isFork, isMainBranch, isMergeQueue } from "../../../machine/code/Git";
import { Target } from "../../target/Target._";

export class Buildkite {
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
