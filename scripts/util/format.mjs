#!/usr/bin/env node

import { createHash } from "node:crypto";
import { getPullRequest, getRepositoryUrl, getSha } from "./git.mjs";
import { isFile, readFile, relative } from "./fs.mjs";
import { getBuildLabel, getBuildUrl } from "./ci.mjs";

/**
 * @typedef {Object} Annotation
 * @property {string} content
 * @property {string} [label]
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [column]
 * @property {"error" | "warning" | "notice"} [type]
 */

/**
 * Formats an annotation into an HTML string.
 * @param {Annotation} annotation
 * @returns {string}
 */
export function formatAnnotation(annotation) {
  const { content, file: filename, line, column, label } = annotation;

  let file, fileUrl;
  if (filename) {
    file = relative(filename).replace(/\\/g, "/");
    fileUrl = getFileUrl(undefined, filename, line, column);
  } else {
    file = relative(process.argv[1]).replace(/\\/g, "/");
    fileUrl = getFileUrl(undefined, file);
  }

  let title = `<code>${file}</code>`;
  if (fileUrl) {
    title = `<a href="${fileUrl}">${title}</a>`;
  }
  if (label) {
    title += ` - ${label}`;
  }

  const build = getBuildLabel();
  const buildUrl = getBuildUrl();

  let status;
  if (build) {
    status = build;
    if (buildUrl) {
      status = `<a href="${buildUrl}">${status}</a>`;
    }
  }

  if (status) {
    title += ` on ${status}`;
  }

  return `<details><summary>${title}</summary>\n\n${content}\n</details>\n\n`;
}

/**
 * Parses through stdout or stderr to find annotations.
 * @param {string} string
 * @returns {Annotation[]}
 */
export function parseAnnotations(string) {
  let i = 0;
  const lines = string.split("\n");

  /**
   * @typedef {Object} Line
   * @property {number} i
   * @property {string} originalLine
   * @property {string} line
   */

  function done() {
    return i >= lines.length;
  }

  /**
   * @returns {Line}
   */
  function peek() {
    if (done()) {
      throw new Error(`Unexpected end of output [${i}/${lines.length}]`);
    }
    const originalLine = lines[i];
    const line = stripAnsi(originalLine);
    return { originalLine, line };
  }

  /**
   * @returns {Line}
   */
  function read() {
    const line = peek();
    i++;
    return line;
  }

  /**
   * @param {(line: Line) => boolean} fn
   * @returns {string[]}
   */
  function readUntil(fn) {
    const lines = [];
    while (!done()) {
      const line = read();
      const { originalLine } = line;
      lines.push(originalLine);
      if (fn(line)) {
        return lines;
      }
    }
    return lines;
  }

  /**
   * @param {number} n
   * @returns {string[]}
   */
  function readNext(n) {
    return readUntil(({ i }) => i >= n);
  }

  /**
   * @param {string | undefined} filename
   * @returns {string | undefined}
   */
  function parseFile(filename) {
    if (!filename) {
      return;
    }
    const parts = normalize(relative(filename)).replace(/\\/g, "/").split("/");
    for (let i = 0; i < parts.length; i++) {
      const path = join(...parts.slice(0, i ? -i : undefined));
      if (isFile(path)) {
        return relative(path);
      }
    }
    return parts.join("/");
  }

  /**
   * @returns {Annotation | undefined}
   */
  function parseNinjaError() {
    const { line } = peek();

    const match = /^FAILED: (?:\S+ )?(\S+)?/.exec(line);
    if (!match) {
      return;
    }

    const [, filename] = match;
    const [title, _, ...errors] = readUntil(({ line }) =>
      /^(?:\d+ errors? generated)|(?:ninja: build stopped)/.test(line),
    );

    return {
      file: parseFile(filename),
      content: codeBlock([title, ...errors].join("\n"), "term"),
      type: "error",
      label: "build error",
    };
  }

  /**
   * @returns {Annotation | undefined}
   */
  function parseZigError() {
    const { line } = peek();

    const match = /^(.*\.zig):(\d+):(\d+): (error|warning):/.exec(line);
    if (!match) {
      return;
    }

    const [, filename, ln, col, type] = match;
    const lines = readUntil(({ line }) => !line);

    return {
      file: parseFile(filename),
      line: parseInt(ln),
      column: parseInt(col),
      content: codeBlock(lines.join("\n"), "term"),
      type: "error",
      label: "zig error",
    };
  }

  /**
   * @returns {Annotation | undefined}
   */
  function parseCrash() {
    const { line } = peek();

    const match = /^thread (\d+) panic: (.*)/.exec(line);
    if (!match) {
      return;
    }

    const [, thread, message] = match;
    const lines = [...readUntil(({ line }) => !line), ...readUntil(({ line }) => !line)];

    let file, ln, col;
    for (const originalLine of lines) {
      const line = stripAnsi(originalLine);
      const match = /^\s*(\S+):(\d+):(\d+)/.exec(line);
      if (match) {
        [, file, ln, col] = match;
        break;
      }
    }

    return {
      file: parseFile(file),
      line: parseInt(ln),
      column: parseInt(col),
      content: codeBlock(lines.join("\n"), "term"),
      type: "error",
      label: "crash",
    };
  }

  /**
   * @type {Annotation[]}
   */
  const annotations = [];

  while (!done()) {
    const annotation = parseZigError() || parseNinjaError() || parseCrash();
    if (annotation) {
      annotations.push(annotation);
    }
    i++;
  }

  return annotations;
}

/**
 * Gets the URL for a file in the repository.
 * @param {string} [cwd]
 * @param {string} [file]
 * @param {string | number} [line]
 * @returns {string | undefined}
 */
export function getFileUrl(cwd, file, line) {
  const baseUrl = getRepositoryUrl(cwd);
  if (!baseUrl || !baseUrl.includes("github.com")) {
    return;
  }

  const filePath = relative(cwd, file).replace(/\\/g, "/");
  const pullRequest = getPullRequest();
  const gitSha = getSha(cwd);

  let url;
  if (pullRequest) {
    const fileMd5 = createHash("md5").update(filePath).digest("hex");
    url = `${baseUrl}/pull/${pullRequest}/files#diff-${fileMd5}`;
    if (typeof line !== undefined) {
      url += `L${line}`;
    }
  } else if (gitSha) {
    url = `${baseUrl}/blob/${gitSha}/${filePath}`;
    if (typeof line !== undefined) {
      url += `#L${line}`;
    }
  }

  return url;
}

/**
 * @param {string} [cwd]
 * @param {string} [file]
 * @param {string | number} [line]
 * @returns {string | undefined}
 */
export function getFilePreview(cwd, file, line) {
  const filePath = relative(cwd, file);
  if (!isFile(filePath)) {
    return;
  }

  const fileContent = readFile(filePath);
  const lines = fileContent.split("\n");
  const startLine = Math.max(0, parseInt(line) - 3);
  const lastLine = Math.min(lines.length, parseInt(line) + 3);
  const previewLines = lines.slice(startLine, lastLine);

  let indent;
  for (const line of previewLines) {
    if (!line.trim()) {
      continue;
    }
    const index = line.search(/\S/);
    if (typeof indent === "undefined" || index < indent) {
      indent = index;
    }
  }

  return previewLines
    .map(line => line.slice(indent || 0))
    .join("\n")
    .trim();
}

/**
 * Parses a string into a boolean.
 * @param {string} string
 * @returns {boolean}
 */
export function parseBoolean(string) {
  if (/^(?:true|1|on|yes)$/i.test(string)) {
    return true;
  }
  if (/^(?:false|0|off|no)$/i.test(string)) {
    return false;
  }
  throw new Error(`Invalid value: expected 'true' or 'false', received '${string}'`);
}

/**
 * Parses a string into a number.
 * @param {string} string
 * @returns {number}
 */
export function parseNumber(string) {
  const number = parseFloat(string);
  if (!Number.isNaN(number)) {
    return number;
  }
  throw new Error(`Invalid value: expected a number, received '${string}'`);
}

/**
 * Parses a string into a millisecond duration.
 * @param {string} string
 * @returns {number | undefined}
 */
export function parseDuration(duration) {
  const match = /(\d+\.\d+)(m?s)/.exec(duration);
  if (!match) {
    return undefined;
  }
  const [, value, unit] = match;
  return parseFloat(value) * (unit === "ms" ? 1 : 1000);
}

/**
 * Parses a string into a semantic version.
 * @param {string} version
 * @returns {number[] | undefined}
 */
export function parseSemver(version) {
  const match = `${version}`.match(/(\d+)\.?(\d+)?\.?(\d+)?/);
  if (!match) {
    return;
  }
  return match
    .slice(1, 4)
    .map(n => parseInt(n))
    .filter(n => isFinite(n));
}

/**
 * Parses a string into a target name.
 * @param {string} target
 * @returns {string}
 */
export function parseTarget(target) {
  const match = /^(?:bun-)?(?<os>[a-z]+)-(?<arch>[a-z0-9]+)(?<suffix>-baseline)?$/i.exec(target);
  if (!match) {
    throw new Error(`Invalid target: ${target}`);
  }

  try {
    const os = parseOs(match.groups.os);
    const arch = parseArch(match.groups.arch);
    const suffix = match.groups.suffix || "";

    if (suffix === "-baseline" && arch !== "x64") {
      throw new Error(`Baseline is not supported on architecture: ${arch}`);
    } else if (os === "windows" && arch !== "x64") {
      throw new Error(`Windows is not supported on architecture: ${arch}`);
    }

    return `${os}-${arch}${suffix}`;
  } catch (cause) {
    throw new Error(`Invalid target: ${target}`, { cause });
  }
}

/**
 * Parses a string into an operating system.
 * @param {string} os
 * @returns {"windows" | "linux" | "darwin"}
 */
export function parseOs(os) {
  if (/darwin|mac|apple/i.test(os)) {
    return "darwin";
  }
  if (/linux/i.test(os)) {
    return "linux";
  }
  if (/windows|win32|cygwin|mingw|msys/i.test(os)) {
    return "windows";
  }
  throw new Error(`Unsupported operating system: ${os}`);
}

/**
 * Parses a string into an architecture.
 * @param {string} arch
 * @returns {"x64" | "aarch64"}
 */
export function parseArch(arch) {
  if (/aarch64|arm64/i.test(arch)) {
    return "aarch64";
  }
  if (/x64|x86_64|amd64/i.test(arch)) {
    return "x64";
  }
  throw new Error(`Unsupported architecture: ${arch}`);
}

/**
 * Formats epoch milliseconds into a human-readable duration.
 * @param {number} epoch
 */
export function formatDuration(epoch) {
  if (isNaN(epoch) || epoch <= 0) {
    return "0s";
  }
  const seconds = epoch / 1000;
  if (seconds < 1) {
    return `${seconds.toFixed(2)}ms`;
  }
  const minutes = seconds / 60;
  if (minutes < 1) {
    return `${seconds.toFixed(2)}s`;
  }
  const hours = minutes / 60;
  if (hours < 1) {
    return `${minutes.toFixed(2)}m`;
  }
  return `${hours.toFixed(2)}h`;
}

/**
 * Sanitizes a string to be used as a path.
 * @param {string} string
 * @returns {string}
 */
export function sanitizePath(string) {
  return string.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

/**
 * Strips ANSI escape codes from a string.
 * @param {string} string
 * @returns {string}
 */
export function stripAnsi(string) {
  return string.replace(/\u001b\[\d+m/g, "");
}

/**
 * Escapes a string for use in GitHub Actions.
 * @param {string} string
 * @returns {string}
 */
export function escapeGitHubAction(string) {
  return string.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Unescapes a string from GitHub Actions.
 * @param {string} string
 * @returns {string}
 */
export function unescapeGitHubAction(string) {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

/**
 * Escapes a string for use in HTML.
 * @param {string} string
 * @returns {string}
 */
export function escapeHtml(string) {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

/**
 * Escapes a string for use in a markdown code block.
 * @param {string} string
 * @returns {string}
 */
export function escapeCodeBlock(string) {
  return string.replace(/`/g, "\\`");
}

/**
 * Formats a string into a markdown code block.
 * @param {string} string
 * @param {string} [lang]
 * @returns {string}
 */
export function codeBlock(string, lang = "") {
  const inner = escapeCodeBlock(string);
  return `\`\`\`${lang}\n${inner}\n\`\`\``;
}

const ansiColors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  pink: "\x1b[37m",
};

/**
 * Formats a string or value with pretty colors.
 * @param {string} value
 * @returns {string}
 */
export function format(value) {
  let string;
  if (value instanceof Error) {
    const { message, stack, cause } = value;
    const stackTrace = stack.split("\n").slice(1).join("\n");
    string = `{reset}${message}\n{dim}${stackTrace}{reset}`;
    if (cause) {
      string += `\n{yellow}{bold}cause{reset}: ${format(cause)}`;
    }
  } else if (typeof value === "string") {
    string = value;
  } else {
    string = inspect(value);
  }
  return string.replace(/{(\w+)}/g, (_, color) => ansiColors[color] || "");
}
