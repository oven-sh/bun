import { PipelineOptionsBuilder } from "../cd/pipeline/PipelineOptionsBuilder.ts";
import { getCommitMessage, isMainBranch } from "../machine/code/git.ts";

type PipelineOptionsBuilderUnknown = PipelineOptionsBuilder<{ id: string }>;

const isDocumentationFile = (filename: string) => /^(\.vscode|\.github|bench|docs|examples)|\.(md)$/i.test(filename);
const isTestFile = (filename: string) => /^test/i.test(filename) || /runner\.node\.mjs$/i.test(filename);

export class CommitMessages {
  static force = ({ changedFiles }: Pick<PipelineOptionsBuilderUnknown, "changedFiles">) => {
    let forceBuild: boolean | undefined;
    let ciFileChanged: boolean | undefined;
    console.log("Checking if CI should be forced...");

    const message = getCommitMessage();
    const match = /\[(force ci|ci force|ci force build)\]/i.exec(message!);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      forceBuild = true;
    }
    // TODO: Static list of core CI files
    for (const coref of [".buildkite/ci.mjs", "scripts/utils.mjs", "scripts/bootstrap.sh", "scripts/machine.mjs"]) {
      if (changedFiles && changedFiles.includes(coref)) {
        console.log(" - Yes, because the list of changed files contains:", coref);
        forceBuild = true;
        ciFileChanged = true;
      }
    }

    return {
      forceBuild,
      ciFileChanged,
    };
  };

  static skipCi = ({
    forceBuild,
    changedFiles,
  }: Pick<PipelineOptionsBuilderUnknown, "changedFiles" | "forceBuild">) => {
    console.log("Checking if CI should be skipped...");
    if (!forceBuild) {
      const message = getCommitMessage();
      const match = /\[(skip ci|no ci|ci skip|ci no)\]/i.exec(message!);
      if (match) {
        const [, reason] = match;
        console.log(" - Yes, because commit message contains:", reason);
        return true;
      }
      if (changedFiles && changedFiles.every((filename: any) => isDocumentationFile(filename))) {
        console.log(" - Yes, because all changed files are documentation");
        return true;
      }
    }

    return false;
  };

  static buildImages = ({ ciFileChanged }: Pick<PipelineOptionsBuilderUnknown, "ciFileChanged">) => {
    console.log("Checking if CI should re-build images...");
    let buildImages: boolean | undefined;

    const message = getCommitMessage();
    const match = /\[(build images?|images? build)\]/i.exec(message!);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      buildImages = true;
    }
    if (ciFileChanged) {
      console.log(" - Yes, because a core CI file changed");
      buildImages = true;
    }
    return buildImages;
  };

  static publishImages = ({ ciFileChanged }: Pick<PipelineOptionsBuilderUnknown, "ciFileChanged">) => {
    console.log("Checking if CI should publish images...");
    let publishImages: boolean | undefined;
    let buildImages: boolean | undefined;

    const message = getCommitMessage();
    const match = /\[(publish images?|images? publish)\]/i.exec(message!);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      publishImages = true;
      buildImages = true;
    }
    if (ciFileChanged && isMainBranch()) {
      console.log(" - Yes, because a core CI file changed and this is main branch");
      publishImages = true;
      buildImages = true;
    }

    return { publishImages, buildImages };
  };

  static skipBuild = ({
    forceBuild,
    changedFiles,
  }: Pick<PipelineOptionsBuilderUnknown, "forceBuild" | "changedFiles">) => {
    console.log("Checking if build should be skipped...");
    let skipBuild: boolean | undefined;
    if (!forceBuild) {
      const message = getCommitMessage();
      const match = /\[(only tests?|tests? only|skip build|no build|build skip|build no)\]/i.exec(message!);
      if (match) {
        const [, reason] = match;
        console.log(" - Yes, because commit message contains:", reason);
        skipBuild = true;
      }
      if (
        changedFiles &&
        changedFiles.every((filename: any) => isTestFile(filename) || isDocumentationFile(filename))
      ) {
        console.log(" - Yes, because all changed files are tests or documentation");
        skipBuild = true;
      }
    }
    return skipBuild;
  };

  static skipTests = () => {
    console.log("Checking if tests should be skipped...");
    let skipTests: boolean | undefined;
    const message = getCommitMessage();
    const match = /\[(skip tests?|tests? skip|no tests?|tests? no)\]/i.exec(message!);
    if (match) {
      console.log(" - Yes, because commit message contains:", match[1]);
      skipTests = true;
    }
    if (isMainBranch()) {
      console.log(" - Yes, because we're on main branch");
      skipTests = true;
    }
    return skipTests;
  };

  static release = () => {
    console.log("Checking if build is a named release from commit...");
    const message = getCommitMessage();
    const match = /\[(release|release build|build release)\]/i.exec(message!);
    if (match) {
      const [, reason] = match;
      console.log(" - Yes, because commit message contains:", reason);
      return true;
    }
  };
}
