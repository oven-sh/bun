import { appendFileSync } from "node:fs";
import {
  getAbi,
  getAbiVersion,
  getArch,
  getBootstrapVersion,
  getBranch,
  getBuildArtifacts,
  getBuildId,
  getBuildLabel,
  getBuildNumber,
  getBuildUrl,
  getCommit,
  getCommitMessage,
  getDistro,
  getDistroVersion,
  getFileUrl,
  getHostname,
  getKernel,
  getMainBranch,
  getOs,
  getPublicIp,
  getPullRequest,
  getRepository,
  getTailscaleIp,
  getTargetBranch,
  getUsername,
  isBuildkite,
  isCI,
  isFork,
  isGithubAction,
  isLinux,
  isMainBranch,
  isMergeQueue,
  isPullRequest,
  isWindows,
  spawnSafe,
  startGroup,
  tmpdir,
  unzip,
} from "../../../scripts/utils.mjs";

declare global {
  const process: {
    env: Record<string, string | undefined>;
    platform: string;
    arch: string;
    cwd: () => string;
  };
}

/**
 * @param {string} name
 * @param {boolean} [required]
 * @returns {string | undefined}
 */
export function getEnv<Required extends boolean>(
  name: string | number,
  required: Required = true as Required,
): Required extends true ? string : string | undefined {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(`Environment variable is missing: ${name}`);
  }

  return value as Required extends true ? string : string | undefined;
}

/**
 * @param {string} name
 * @param {string | undefined} value
 */
export function setEnv(name: string, value: string | undefined) {
  process.env[name] = value;

  if (isGithubAction && !/^GITHUB_/i.test(name)) {
    const envFilePath = process.env["GITHUB_ENV"];
    if (envFilePath) {
      const delimeter = Math.random().toString(36).substring(2, 15);
      const content = `${name}<<${delimeter}\n${value}\n${delimeter}\n`;
      appendFileSync(envFilePath, content);
    }
  }
}

export function print(object: unknown) {
  if (isBuildkite) {
    if (object instanceof Object) {
      Object.entries(object).forEach(([k, v]) => {
        console.log(`${k}: ${v}`);
      });
    } else {
      console.log(object);
    }
  } else {
    console.dir(object, { depth: null });
  }
}

export function printEnvironment() {
  startGroup("Machine", () => {
    print({
      "Operating System": getOs(),
      "Architecture": getArch(),
      "Kernel": getKernel(),
      "Linux": isLinux
        ? {
            "ABI": getAbi(),
            "ABI Version": getAbiVersion(),
          }
        : undefined,
      "Distro": getDistro(),
      "Distro Version": getDistroVersion(),
      "Hostname": getHostname(),
      "CI": isCI
        ? {
            "Tailscale IP": getTailscaleIp(),
            "Public IP": getPublicIp(),
          }
        : undefined,
      "Username": getUsername(),
      "Working Directory": process.cwd(),
      "Temporary Directory": tmpdir(),
    });
  });

  if (isCI) {
    startGroup("Environment", () => {
      for (const [key, value] of Object.entries(process.env)) {
        console.log(`${key}:`, value);
      }
    });
  }

  startGroup("Repository", () => {
    print({
      "Repository": getRepository(),
      "Commit": getCommit(),
      "Commit Message": getCommitMessage(),
      "Branch": getBranch(),
      "Main Branch": getMainBranch(),
      "Is Fork": isFork(),
      "Is Merge Queue": isMergeQueue(),
      "Is Main Branch": isMainBranch(),
      "Is Pull Request": isPullRequest(),
      "Pull Request": isPullRequest() ? getPullRequest() : undefined,
      "Target Branch": isPullRequest() ? getTargetBranch() : undefined,
    });
  });

  if (isCI) {
    startGroup("CI", () => {
      print({
        "CI": {
          "Build ID": getBuildId(),
          "Build Label": getBuildLabel(),
          "Build URL": getBuildUrl(),
          "Buildkite": isBuildkite
            ? {
                "Build Artifacts": getBuildArtifacts(),
              }
            : undefined,
        },
        "Bootstrap Version": getBootstrapVersion(),
      });
    });
  }
}
export {
  getBootstrapVersion,
  getBuildNumber,
  getBuildUrl,
  getFileUrl,
  isCI,
  isGithubAction,
  isLinux,
  isWindows,
  spawnSafe,
  startGroup,
  tmpdir,
  unzip,
};
