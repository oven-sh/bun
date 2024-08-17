import { spawn, spawnSync } from "./spawn.mjs";
import { isFile } from "./fs.mjs";
import { parseOs, parseArch } from "./format.mjs";

/**
 * Tests if the Docker daemon is enabled.
 * @returns {boolean}
 */
export function isEnabled() {
  const { exitCode, stdout } = spawnSync(docker, ["info"], { throwOnError: false });
  if (exitCode === 0 && !/error:/i.test(stdout)) {
    return true;
  }
  return false;
}

/**
 * Tests if this process is running inside a Docker container.
 * @returns {boolean}
 */
export function isInsideDocker() {
  return isFile("/.dockerenv");
}

/**
 * Gets the Docker platform for the given target.
 * @param {string} [os]
 * @param {string} [arch]
 */
export function getPlatform(os = process.platform, arch = process.arch) {
  return `${parseOs(os)}/${parseArch(arch)}`;
}

/**
 * @typedef {Object} DockerBuildOptions
 * @property {string} [image]
 * @property {string} [file]
 * @property {string} [filePath]
 * @property {string} [os]
 * @property {string} [arch]
 */

/**
 * Runs `docker build` and returns the image ID.
 * @param {DockerBuildOptions & SpawnOptions} options
 * @returns {Promise<string>}
 */
export async function build(options) {
  const { image, file, filePath, cwd, os, arch, env } = options;
  const platform = getPlatform(os, arch);
  const args = ["build", cwd || ".", "--progress", "plain", "--platform", platform];

  if (image) {
    args.push("-t", image);
  }

  if (file) {
    const filePath = join(mkdirTemp("docker"), "Dockerfile");
    writeFile(filePath, file);
    args.push("-f", filePath);
  } else if (filePath) {
    args.push("-f", filePath);
  }

  for (const [key, value] of Object.entries(env || {})) {
    args.push("--build-arg", `${key}=${value}`);
  }

  if (image) {
    args.push("--output", `type=image,name=${image}`);
  } else {
    args.push("--output", `type=image,push-by-digest=true`);
  }

  const { stderr } = await spawn("docker", args, { ...options, env: undefined });

  const match = /writing image sha256:(?<digest>[a-f0-9]+)/i.exec(stderr);
  const imageId = match?.groups?.digest;
  if (!imageId) {
    throw new Error(`Failed to build Docker image: ${stderr}`);
  }

  return imageId;
}

/**
 * @typedef {Object} DockerRunOptions
 * @property {string} [image]
 * @property {string} [os]
 * @property {string} [arch]
 * @property {[string, string][]} [mounts]
 */

/**
 * Spawns a command in a Docker container.
 * @param {DockerRunOptions & SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
export async function run(command, args, options = {}) {
  const { image, os, arch, env, mounts, silent } = options;
  const platform = getPlatform(os, arch);

  const dockerArgs = ["run", "--platform", platform, "--rm", "--init", "--interactive"];
  for (const stdio of ["stdin", "stdout", "stderr"]) {
    dockerArgs.push("--attach", stdio);
  }
  for (const [key, value] of Object.entries(env || {})) {
    dockerArgs.push("--env", `${key}=${value}`);
  }
  for (const [source, target] of mounts || []) {
    mkdir(source);
    dockerArgs.push("--mount", `type=bind,source=${source},target=${target}`);
  }
  if (silent) {
    dockerArgs.push("--quiet");
  }

  await spawn("docker", [...dockerArgs, image, command, ...args], { ...options, env: undefined });
}
