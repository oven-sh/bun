#!/usr/bin/env node

import { isWindows, isBuildKite, isGithubAction, isVerbose } from "./env.mjs";
import { spawnSync } from "./spawn.mjs";
import { isFile, join } from "./fs.mjs";
import {
  format,
  formatAnnotation,
  formatDuration,
  parseBoolean,
  parseNumber,
  parseSemver,
  stripAnsi,
} from "./format.mjs";
import * as buildkite from "./buildkite.mjs";

/**
 * @typedef {Object} WhichOptions
 * @property {string} [path]
 * @property {string} [minVersion]
 * @property {string} [exactVersion]
 */

/**
 * Returns the path to the given command.
 * @param {string | string[]} command
 * @param {WhichOptions} options
 * @returns {string}
 */
export function which(command, options = {}) {
  const commands = Array.isArray(command) ? command : [command];
  const { path = process.env.PATH, minVersion, exactVersion } = options;

  if (isVerbose) {
    printCommand("which", commands, { env: { PATH: path } });
  }

  const paths = [];
  for (const command of commands) {
    if (isFile(command) && !paths.includes(command)) {
      paths.push(command);
    }
  }

  for (const binPath of path.split(isWindows ? ";" : ":")) {
    const names = isWindows ? ["exe", "cmd", "bat"].flatMap(ext => commands.map(cmd => `${cmd}.${ext}`)) : commands;
    for (const name of names) {
      const path = join(binPath, name);
      if (isFile(path) && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }

  if (isVerbose) {
    for (const path of paths) {
      print(path);
    }
  }

  return paths.filter(
    path =>
      (!minVersion && !exactVersion) ||
      (minVersion && compareSemver(getVersion(path), minVersion) >= 0) ||
      (exactVersion && compareSemver(getVersion(path), exactVersion) === 0),
  )[0];
}

/**
 * Gets the version of the given command.
 * @param {string} command
 * @returns {string | undefined}
 */
export function getVersion(command) {
  let args;
  let env = { PATH: process.env.PATH };
  if (/(?:zig|go)$/.test(command)) {
    args = ["version"];
  } else if (/(?:bun|bun\-[a-z]+)$/.test(command)) {
    args = ["--revision"];
    env["BUN_DEBUG_QUIET_LOGS"] = "1";
  } else if (/docker$/.test(command)) {
    args = ["version", "--format", "{{.Server.Version}}"];
  } else {
    args = ["--version"];
  }

  const { exitCode, stdout } = spawnSync(command, args, {
    silent: !isVerbose,
    throwOnError: false,
    env,
  });

  if (exitCode === 0) {
    const version = parseSemver(stdout)?.join(".");
    if (isVerbose && version) {
      print(version);
    }
    return version;
  }
}

/**
 * Compares two semantic versions, returning -1 if a < b, 0 if a == b, and 1 if a > b.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const a0 = parseSemver(a);
  const b0 = parseSemver(b);
  if (!a0 || !b0) {
    return 0;
  }
  for (let i = 0; i < 3; i++) {
    const a1 = a0[i];
    const b1 = b0[i];
    if (typeof a1 !== "number" || typeof b1 !== "number") {
      return 0;
    }
    if (a1 !== b1) {
      return a1 - b1;
    }
  }
  return 0;
}

/**
 * @typedef {Object} Command
 * @property {string} name
 * @property {string} [command]
 * @property {string[]} [aliases]
 * @property {string} [env]
 * @property {string} [minVersion]
 * @property {string} [exactVersion]
 * @property {boolean} [throwIfNotFound]
 */

/**
 * Asserts that a command is installed.
 * @param {Command} options
 * @returns {string}
 */
export function getCommand(options = {}) {
  const { name, command = name, aliases = [], minVersion, exactVersion, throwIfNotFound } = options;

  const option = getOption({ name });
  const label = option || command;
  if (isVerbose) {
    print(`Command:{reset} {cyan}{bold}${label}{reset}`);
  }

  const commands = option ? [option] : [command, ...aliases];
  const path = which([...commands], {
    minVersion,
    exactVersion,
  });

  if (!path && throwIfNotFound) {
    throw new Error(`Command not found: ${label}`);
  }

  return path;
}

/**
 * Prints a message to console.
 * @param {...any} args
 */
export function print(...args) {
  console.log(...args.map(arg => format(arg)));
}

/**
 * Prints a command to console.
 * @param {string} command
 * @param {string[]} args
 * @param {import("./spawn.mjs").SpawnOptions} options
 */
export function printCommand(command, args, options) {
  if (!isVerbose || options?.silent) {
    return;
  }
  print(`{cyan}$ {reset}{dim}${command} ${args.map(arg => (arg?.includes(" ") ? `"${arg}"` : arg)).join(" ")}{reset}`);
}

/**
 * Prints a warning message to console.
 * @param {...any} args
 */
export function emitWarning(...args) {
  console.warn(format("{yellow}{bold}warning{reset}:"), ...args.map(arg => format(arg)));
}

/**
 * Emits an annotation.
 * @param {import("./format.mjs").Annotation} annotation
 */
export async function emitAnnotation(annotation) {
  const content = formatAnnotation(annotation);

  if (isBuildKite) {
    const { file } = annotation;
    await buildkite.addAnnotation(content, {
      context: file,
      style: "error",
      append: true,
    });
  }

  if (isVerbose) {
    error(content);
  }
}

/**
 * Prints an error message to console and exits the process.
 * @param {...any} args
 */
export function error(...args) {
  console.error(format("{red}{bold}error{reset}:"), ...args.map(arg => format(arg)));
}

/**
 * @param  {...any} args
 * @returns {never}
 */
export function fatalError(...args) {
  error(...args);
  process.exit(1);
}

/**
 * CLI options.
 */

/**
 * @typedef {Object} Option
 * @property {string} name
 * @property {string} [description]
 * @property {"string" | "boolean" | "number"} [type]
 * @property {string | string[]} [flag]
 * @property {string | string[]} [env]
 * @property {string | Function} [defaultValue]
 * @property {Function} [parse]
 */

/**
 * Parses an option from the command line or environment.
 * @param {Option} option
 */
export function getOption(option) {
  const { name, type, flag = name, env = name, defaultValue, parse } = option;
  const args = process.argv.slice(2);

  /**
   * @param {string} name
   * @returns {string | undefined}
   */
  function parseFlag(name) {
    const label = name.length === 1 ? `-${name}` : `--${name}`;
    const hasValue = type !== "boolean";
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === label) {
        if (!hasValue) {
          return "true";
        }
        if (i + 1 >= args.length) {
          throw new Error(`Option requires a value: ${arg}`);
        }
        const value = args[i + 1];
        if (value.startsWith("-")) {
          throw new Error(`Option requires a value, but received a flag instead: ${arg} ${value}`);
        }
        return value;
      }
      const prefix = `${label}=`;
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length);
      }
    }
  }

  let flagValue;
  if (typeof flag === "string") {
    flagValue = parseFlag(flag);
  } else if (Array.isArray(flag)) {
    for (const name of flag) {
      flagValue = parseFlag(name);
      if (flagValue) {
        break;
      }
    }
  }

  const flagName = Array.isArray(flag) ? flag[0] : flag;
  if (flagValue && isVerbose) {
    print(`Option: {yellow}{bold}--${flagName}{reset} {dim}${flagValue}{reset}`);
  }

  /**
   * @param {string} name
   * @returns {string | undefined}
   */
  function parseEnv(name) {
    const label = name.replace(/-/g, "_");
    const value = process.env[label] || process.env[`${label.toUpperCase()}`] || process.env[`${label.toLowerCase()}`];
    if (value) {
      return value;
    }
  }

  let envValue;
  if (typeof env === "string") {
    envValue = parseEnv(env);
  } else if (Array.isArray(env)) {
    for (const name of env) {
      envValue = parseEnv(name);
      if (envValue) {
        break;
      }
    }
  }

  const envName = Array.isArray(env) ? env[0] : env;
  if (envValue && isVerbose) {
    print(`Option: {magenta}{bold}$${envName}{reset} {dim}${envValue}{reset}`);
  }

  const label = flagValue ? `--${flagName}` : `$${envName}`;
  if (flagValue && envValue && flagValue !== envValue) {
    throw new Error(`Option has conflicting values: --${flagName} ${flagValue} and $${envName}=${envValue}`);
  }

  let value = flagValue || envValue;
  if (!value) {
    if (typeof defaultValue === "function") {
      value = defaultValue();
    } else {
      value = defaultValue;
    }
  }

  if (typeof value === "undefined" || value === null || Number.isNaN(value)) {
    return;
  } else if (typeof value !== "string") {
    value = `${value}`;
  }

  let fn;
  if (typeof parse === "function") {
    fn = parse;
  } else if (type === "boolean") {
    fn = parseBoolean;
  } else if (type === "number") {
    fn = parseNumber;
  }

  if (!fn) {
    return value;
  }

  try {
    return fn(value);
  } catch (cause) {
    throw new Error(`Option is invalid: ${label} ${value}`, { cause });
  }
}

/**
 * Adds a path to the PATH environment variable.
 * @param {string} binPath
 */
export function addToPath(binPath) {
  const delim = isWindows ? ";" : ":";
  const path = process.env["PATH"];

  if (!path || path.includes(binPath)) {
    return;
  }

  if (isVerbose) {
    print(`Adding {dim}${binPath}{reset} to PATH`);
  }
  process.env["PATH"] = `${binPath}${delim}${path}`;
}

/**
 * Runs a task with a label.
 * @param {string} label
 * @param {Function} fn
 */
export async function runTask(label, fn) {
  if (isGithubAction) {
    print(`::group::${stripAnsi(format(label))}`);
  } else if (isBuildKite) {
    print(`--- ${label}`);
  } else {
    print(label);
  }

  const start = Date.now();
  try {
    return await fn();
  } finally {
    const duration = Date.now() - start;
    if (duration > 10) {
      print(`Took ${formatDuration(duration)}`);
    }

    if (isGithubAction) {
      print("::endgroup::");
    }
  }
}

/**
 * Gets whether an error is busy and needs a backoff.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBusy(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const { code } = error;
  return code === "EBUSY" || code === "ETIMEDOUT" || code === "UNKNOWN";
}

/**
 * @param {number} retries
 */
export async function backOff(retries = 0) {
  await new Promise(resolve => setTimeout(resolve, (retries + 1) * 1000));
}
