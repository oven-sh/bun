#!/usr/bin/env node

import { dirname, join, readFile } from "./util/fs.mjs";
import { spawn } from "./util/spawn.mjs";
import { codeBlock, getFilePreview } from "./util/format.mjs";
import { error, emitAnnotation, runTask } from "./util/util.mjs";
import { isMain } from "./env.mjs";

const scriptsPath = import.meta.dirname;
const cwd = dirname(scriptsPath);

/**
 * Searches for banned keywords in Zig files.
 * @returns {Promise<Message[]>}
 */
async function lintZig() {
  const bannedPath = join(scriptsPath, "resources", "banned-zig.json");
  const bannedEntries = Object.entries(JSON.parse(readFile(bannedPath)));
  const excludedPaths = ["windows-shim"];

  const results = await Promise.all(
    bannedEntries.flatMap(async ([banned, suggestion]) => {
      const { stdout } = await spawn("git", ["grep", "-n", "-F", banned, "src/**.zig"], {
        cwd,
        throwOnError: false,
        silent: true,
      });

      return stdout.split("\n").map(line => {
        if (!line || excludedPaths.some(path => line.includes(path))) {
          return;
        }

        const [file, ln, ...remaining] = line.split(":");
        const match = remaining.join(":").trim();
        if (match.startsWith("//")) {
          return;
        }

        error(`${file}:${ln}: "${banned}" is banned, ${suggestion}`);

        const preview = getFilePreview(cwd, file, ln);
        const diff = preview
          .split("\n")
          .map(line => (line.includes(match) ? `- ${line}` : `  ${line}`))
          .join("\n");

        return {
          file,
          line: parseInt(ln),
          label: "error",
          content: `Reason: "${banned}" is banned, ${suggestion}\n${codeBlock(diff, "diff")}`,
        };
      });
    }),
  );

  return results.flat().filter(Boolean);
}

if (isMain(import.meta.url)) {
  const errors = await runTask("{dim}Linting{reset}", lintZig);
  await Promise.all(errors.map(error => emitAnnotation(error)));
  process.exit(errors.length ? 1 : 0);
}
