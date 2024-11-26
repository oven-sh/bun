import { CommitMessages } from "../../../command/CommitMessages.ts";
import { getEnv } from "../../../machine/context/process.ts";
import { getLastSuccessfulBuild } from "../../../machine/executor/buildkite.ts";
import { type Agent } from "../../agent/Agent.ts";

export type BuildkiteBuild = {
  id: string;
  commit_id: string;
  branch_name: string;
  state?: string;
  path?: string;
};

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

export class BuildkitePipeline {
  constructor() {}

  static lastBuild = async (): Promise<BuildkiteBuild | undefined> => {
    console.log("Checking last successful build...");
    const lastBuild = await getLastSuccessfulBuild();
    if (lastBuild) {
      const { id, path, commit_id: commit } = lastBuild;
      console.log(" - Build ID:", id);
      console.log(" - Build URL:", new URL(path!, "https://buildkite.com/").toString());
      console.log(" - Commit:", commit);
    } else {
      console.log(" - No build found");
    }
    return lastBuild;
  };

  static changedFiles = async (): Promise<string[]> => {
    let changedFiles: string[] = [];
    // FIXME: Fix various bugs when calculating changed files
    // false -> !isFork() && !isMainBranch()
    // if (false) {
    //   console.log("Checking changed files...");
    //   const baseRef = lastBuild?.commit_id || getTargetBranch() || getMainBranch();
    //   console.log(" - Base Ref:", baseRef);
    //   const headRef = getCommit();
    //   console.log(" - Head Ref:", headRef);

    //   changedFiles = await getChangedFiles(undefined, baseRef, headRef);
    //   if (changedFiles) {
    //     if (changedFiles.length) {
    //       changedFiles.forEach(filename => console.log(` - ${filename}`));
    //     } else {
    //       console.log(" - No changed files");
    //     }
    //   }
    // }

    return changedFiles;
  };

  static buildRelease = async (): Promise<boolean> => {
    console.log("Checking if build is a named release...");
    if (/^(1|true|on|yes)$/i.test(getEnv("RELEASE", false) ?? "")) {
      console.log(" - Yes, because RELEASE environment variable is set");
      return true;
    } else {
      return CommitMessages.release() ?? false;
    }
  };
}
