import { watch } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { isBuildkite } from "./runner.node.mjs";
import { uploadArtifact } from "./utils.mjs";
import { existsSync, readFileSync } from "node:fs";

// Get core dump directory from system configuration or use default
function getCoreDumpDir() {
  try {
    // Try to read from /proc/sys/kernel/core_pattern
    const corePattern = readFileSync("/proc/sys/kernel/core_pattern", "utf8").trim();

    // If core_pattern contains a path (not starting with | for piping)
    if (corePattern && !corePattern.startsWith("|")) {
      // Extract directory path from the pattern
      const dir = corePattern.split("/").slice(0, -1).join("/");
      if (dir) return dir;
    }
  } catch (error) {
    // Fallback to default if any error occurs
    console.warn("Could not determine core dump directory:", error.message);
  }

  // Check common locations
  for (const dir of ["/var/crash", "/var/lib/systemd/coredump", "/cores"]) {
    if (existsSync(dir)) return dir;
  }

  return "/var/crash"; // Default fallback
}

var watcher;

/**
 * Watches for core dumps on Linux, compresses them in memory,
 * uploads them as BuildKite artifacts, and deletes the original files.
 */
export function startWatcher() {
  // Skip if not on Linux or not in BuildKite
  if (process.platform !== "linux" || !isBuildkite) {
    console.log("Core dump watcher not started (requires Linux and BuildKite)");
    return;
  }

  const coreDumpDir = getCoreDumpDir();

  try {
    console.log(`Starting core dump watcher on ${coreDumpDir}`);
    let uploadedFiles = new Set();
    watcher = watch(coreDumpDir, async (eventType, filename) => {
      if (!filename || !filename.startsWith("core.")) {
        return;
      }

      if (eventType === "rename") return;

      const coreDumpPath = join(coreDumpDir, filename);
      try {
        if (uploadedFiles.has(coreDumpPath) || statSync(coreDumpPath).size === 0) {
          return;
        }

        uploadedFiles.add(coreDumpPath);

        console.log(`Found core dump: ${coreDumpPath}`);

        // Compress the file and write it to disk
        const compressedFilePath = `${coreDumpPath}.gz`;
        await pipeline(fs.createReadStream(coreDumpPath), createGzip(), fs.createWriteStream(compressedFilePath));
        unlink(coreDumpPath).catch(() => {});
        await uploadArtifact(compressedFilePath, coreDumpDir);
        console.log(`Uploaded core dump as artifact: ${compressedFilePath}`);

        console.log(`Deleted original core dump: ${coreDumpPath}`);
      } catch (error) {
        console.error(`Error processing core dump ${filename}:`, error);
      }
    });

    // Keep track of the watcher to close it if needed
    process.on("beforeExit", () => {
      watcher.close();
    });
  } catch (error) {
    console.error("Failed to start core dump watcher:", error);
  }
}
