/**
 * Cross-runtime `which` utility.
 * Uses Bun.which when running on Bun, spawns `which` command otherwise.
 */

declare const Bun: typeof import("bun") | undefined;

function which(command: string): string | null {
  if (typeof Bun !== "undefined") {
    return Bun.which(command);
  }

  // Fallback for Node.js or other runtimes
  const { execSync } = require("node:child_process");
  try {
    const result = execSync(`which ${command}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

export default which;
export { which };
