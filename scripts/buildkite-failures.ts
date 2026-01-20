#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";

// Check if we're in a TTY for color support
const isTTY = process.stdout.isTTY || process.env.FORCE_COLOR === "1";

// Get git root directory
let gitRoot = process.cwd();
try {
  gitRoot = (await $`git rev-parse --show-toplevel`.quiet().text()).trim();
} catch {
  // Fall back to current directory if not in a git repo
}

// Helper to convert file path to file:// URL if it exists
function fileToUrl(filePath) {
  try {
    // Extract just the file path without line numbers or other info
    const match = filePath.match(/^([^\s:]+\.(ts|js|tsx|jsx|zig))/);
    if (!match) return filePath;

    const cleanPath = match[1];
    const fullPath = resolve(gitRoot, cleanPath);

    if (existsSync(fullPath)) {
      return `file://${fullPath}`;
    }
  } catch (error) {
    // If anything fails, just return the original path
  }

  return filePath;
}

// Color codes - simpler color scheme
const colors = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  bgBlue: isTTY ? "\x1b[44m" : "",
  bgRed: isTTY ? "\x1b[41m" : "",
  white: isTTY ? "\x1b[97m" : "",
};

// Parse command line arguments
const args = process.argv.slice(2);

// Show help
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun run scripts/buildkite-failures.ts [options] [build-id|branch|pr-url|buildkite-url]

Shows detailed error information from BuildKite build failures.
Full logs are saved to /tmp/bun-build-{number}-{platform}-{step}.log

Arguments:
  build-id          BuildKite build number (e.g., 35051)
  branch            Git branch name (e.g., main, claude/fix-bug)
  pr-url            GitHub PR URL (e.g., https://github.com/oven-sh/bun/pull/26173)
  buildkite-url     BuildKite build URL
  #number           GitHub PR number (e.g., #26173)
  (none)            Uses current git branch

Options:
  --flaky, -f       Include flaky test annotations
  --warnings, -w    Include warning annotations
  --wait            Poll continuously until build completes or fails
  --help, -h        Show this help message

Examples:
  bun run scripts/buildkite-failures.ts                    # Current branch
  bun run scripts/buildkite-failures.ts main               # Main branch
  bun run scripts/buildkite-failures.ts 35051              # Build #35051
  bun run scripts/buildkite-failures.ts #26173             # PR #26173
  bun run scripts/buildkite-failures.ts --wait             # Wait for current branch build to complete
`);
  process.exit(0);
}

const showWarnings = args.includes("--warnings") || args.includes("-w");
const showFlaky = args.includes("--flaky") || args.includes("-f");
const waitMode = args.includes("--wait");
const inputArg = args.find(arg => !arg.startsWith("-") && !arg.startsWith("--"));

// Determine what type of input we have
let buildNumber = null;
let branch = null;

if (inputArg) {
  // BuildKite URL
  if (inputArg.includes("buildkite.com")) {
    const buildMatch = inputArg.match(/builds\/(\d+)/);
    if (buildMatch) {
      buildNumber = buildMatch[1];
    }
  }
  // GitHub PR URL
  else if (inputArg.includes("github.com") && inputArg.includes("/pull/")) {
    const prMatch = inputArg.match(/pull\/(\d+)/);
    if (prMatch) {
      // Fetch PR info from GitHub API
      const prNumber = prMatch[1];
      const prResponse = await fetch(`https://api.github.com/repos/oven-sh/bun/pulls/${prNumber}`);
      if (prResponse.ok) {
        const pr = await prResponse.json();
        branch = pr.head.ref;
      }
    }
  }
  // Plain number or #number - assume it's a GitHub PR
  else if (/^#?\d+$/.test(inputArg)) {
    const prNumber = inputArg.replace("#", "");
    const prResponse = await fetch(`https://api.github.com/repos/oven-sh/bun/pulls/${prNumber}`);
    if (prResponse.ok) {
      const pr = await prResponse.json();
      branch = pr.head.ref;
    } else {
      // If not a valid PR, maybe it's a BuildKite build number
      buildNumber = prNumber;
    }
  }
  // Otherwise assume it's a branch name
  else {
    branch = inputArg;
  }
} else {
  // No input, use current branch
  branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
}

// If branch specified, find latest build
if (!buildNumber) {
  const buildsUrl = `https://buildkite.com/bun/bun/builds?branch=${encodeURIComponent(branch)}`;
  const response = await fetch(buildsUrl);
  const html = await response.text();
  const match = html.match(/\/bun\/bun\/builds\/(\d+)/);

  if (!match) {
    console.log(`No builds found for branch: ${branch}`);
    process.exit(0);
  }

  buildNumber = match[1];
}

// Helper to format time ago
function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "not started";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  return `${diffSecs} second${diffSecs !== 1 ? "s" : ""} ago`;
}

// Helper to clear line for updates
const clearLine = isTTY ? "\x1b[2K\r" : "";

// Poll for build status
let build: any;
let pollCount = 0;
const pollInterval = 10000; // 10 seconds

while (true) {
  // Fetch build JSON
  const buildResponse = await fetch(`https://buildkite.com/bun/bun/builds/${buildNumber}.json`);
  build = await buildResponse.json();

  // Check for failed jobs first (even if build is still running)
  const failedJobsEarly =
    build.jobs?.filter(
      (job: any) => job.exit_status && job.exit_status > 0 && !job.soft_failed && job.type === "script",
    ) || [];

  // In wait mode with failures, stop polling and show failures
  if (waitMode && failedJobsEarly.length > 0) {
    if (pollCount > 0) {
      process.stdout.write(clearLine);
    }
    break;
  }

  // Calculate time ago (use created_at as fallback for scheduled/pending builds)
  const timeAgo = formatTimeAgo(build.started_at || build.created_at);

  // Check if build passed
  if (build.state === "passed") {
    if (pollCount > 0) {
      process.stdout.write(clearLine);
    }
    console.log(`${timeAgo} - build #${buildNumber} https://buildkite.com/bun/bun/builds/${buildNumber}\n`);
    console.log(`${colors.green}✅ Passed!${colors.reset}`);
    process.exit(0);
  }

  // Check if build was canceled
  if (build.state === "canceled" || build.state === "canceling") {
    if (pollCount > 0) {
      process.stdout.write(clearLine);
    }
    console.log(`${timeAgo} - build #${buildNumber} https://buildkite.com/bun/bun/builds/${buildNumber}\n`);
    console.log(`${colors.dim}🚫 Build was canceled${colors.reset}`);
    process.exit(0);
  }

  // Check if build is pending/running/scheduled
  if (
    build.state === "scheduled" ||
    build.state === "running" ||
    build.state === "creating" ||
    build.state === "started"
  ) {
    const runningJobs = build.jobs?.filter((job: any) => job.state === "running") || [];
    const pendingJobs = build.jobs?.filter((job: any) => job.state === "scheduled" || job.state === "waiting") || [];
    const passedJobs = build.jobs?.filter((job: any) => job.state === "passed") || [];
    const totalJobs = build.jobs?.filter((job: any) => job.type === "script")?.length || 0;

    if (waitMode) {
      // In wait mode, show a single updating line
      let statusMsg = "";
      if (build.state === "scheduled" || build.state === "creating") {
        statusMsg = `⏳ Waiting... (scheduled ${formatTimeAgo(build.created_at)})`;
      } else {
        statusMsg = `🔄 Running... ${passedJobs.length}/${totalJobs} passed, ${runningJobs.length} running`;
      }
      process.stdout.write(`${clearLine}${colors.dim}${statusMsg}${colors.reset}`);
      pollCount++;
      await Bun.sleep(pollInterval);
      continue;
    } else {
      // Not in wait mode, show full status and exit
      console.log(`${timeAgo} - build #${buildNumber} https://buildkite.com/bun/bun/builds/${buildNumber}\n`);

      if (build.state === "scheduled" || build.state === "creating") {
        console.log(`${colors.dim}⏳ Build is scheduled/pending${colors.reset}`);
        if (build.created_at) {
          console.log(`${colors.dim}   Created: ${formatTimeAgo(build.created_at)}${colors.reset}`);
        }
      } else {
        console.log(`${colors.dim}🔄 Build is running${colors.reset}`);
        if (build.started_at) {
          console.log(`${colors.dim}   Started: ${formatTimeAgo(build.started_at)}${colors.reset}`);
        }
        console.log(
          `${colors.dim}   Progress: ${passedJobs.length}/${totalJobs} jobs passed, ${runningJobs.length} running, ${pendingJobs.length} pending${colors.reset}`,
        );

        if (runningJobs.length > 0) {
          console.log(`\n${colors.dim}Running jobs:${colors.reset}`);
          for (const job of runningJobs.slice(0, 5)) {
            const name = job.name || job.label || "Unknown";
            console.log(`   ${colors.dim}• ${name}${colors.reset}`);
          }
          if (runningJobs.length > 5) {
            console.log(`   ${colors.dim}... and ${runningJobs.length - 5} more${colors.reset}`);
          }
        }
      }
      process.exit(0);
    }
  }

  // Build is in a terminal state (failed, etc.) - break out of loop
  break;
}

// Print header for failed build
const timeAgo = formatTimeAgo(build.started_at || build.created_at);
console.log(`${timeAgo} - build #${buildNumber} https://buildkite.com/bun/bun/builds/${buildNumber}\n`);

// Get failed jobs
const failedJobs =
  build.jobs?.filter(job => job.exit_status && job.exit_status > 0 && !job.soft_failed && job.type === "script") || [];

// Platform emoji mapping
const platformMap = {
  "darwin": "🍎",
  "macos": "🍎",
  "ubuntu": "🐧",
  "debian": "🐧",
  "alpine": "🐧",
  "linux": "🐧",
  "windows": "🪟",
  "win": "🪟",
};

// Fetch annotations by scraping the build page
const pageResponse = await fetch(`https://buildkite.com/bun/bun/builds/${buildNumber}`);
const pageHtml = await pageResponse.text();

// Extract script tags using HTMLRewriter
let annotationsData = null;
const scriptContents: string[] = [];

const scriptRewriter = new HTMLRewriter().on("script", {
  text(text) {
    scriptContents.push(text.text);
  },
});

await new Response(scriptRewriter.transform(new Response(pageHtml))).text();

// Find the registerRequest call in script contents
const fullScript = scriptContents.join("");
let registerRequestIndex = fullScript.indexOf("registerRequest");

// Find the AnnotationsListRendererQuery after registerRequest
if (registerRequestIndex !== -1) {
  const afterRegisterRequest = fullScript.substring(registerRequestIndex);
  const annotationsIndex = afterRegisterRequest.indexOf('"AnnotationsListRendererQuery"');
  if (annotationsIndex === -1 || annotationsIndex > 100) {
    // Not the right registerRequest call
    registerRequestIndex = -1;
  }
}

if (registerRequestIndex !== -1) {
  try {
    // Find the start of the JSON object (after the comma and any whitespace)
    let jsonStart = registerRequestIndex;

    // Skip to the opening brace, accounting for the function name and first parameter
    let commaFound = false;
    for (let i = registerRequestIndex; i < fullScript.length; i++) {
      if (fullScript[i] === "," && !commaFound) {
        commaFound = true;
      } else if (commaFound && fullScript[i] === "{") {
        jsonStart = i;
        break;
      }
    }

    // Find the matching closing brace, considering strings
    let braceCount = 0;
    let jsonEnd = jsonStart;
    let inString = false;
    let escapeNext = false;

    for (let i = jsonStart; i < fullScript.length; i++) {
      const char = fullScript[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !inString) {
        inString = true;
      } else if (char === '"' && inString) {
        inString = false;
      }

      if (!inString) {
        if (char === "{") braceCount++;
        else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }

    const jsonString = fullScript.substring(jsonStart, jsonEnd);
    annotationsData = JSON.parse(jsonString);
    const edges = annotationsData?.build?.annotations?.edges || [];

    // Just collect all unique annotations by context
    const annotationsByContext = new Map();

    for (const edge of edges) {
      const node = edge.node;
      if (!node || !node.context) continue;

      // Skip if we already have this context
      if (annotationsByContext.has(node.context)) {
        continue;
      }

      annotationsByContext.set(node.context, {
        context: node.context,
        html: node.body?.html || "",
      });
    }

    // Collect annotations
    const annotations = Array.from(annotationsByContext.values());

    // Group annotations by test file to detect duplicates
    const annotationsByFile = new Map();
    const nonFileAnnotations = [];

    for (const annotation of annotations) {
      // Check if this is a file-based annotation
      const isFileAnnotation = annotation.context.match(/\.(ts|js|tsx|jsx|zig)$/);

      if (isFileAnnotation) {
        // Parse the HTML to extract all platform sections
        const html = annotation.html || "";

        // Check if this annotation contains multiple <details> sections (one per platform)
        const detailsSections = html.match(/<details>[\s\S]*?<\/details>/g);

        if (detailsSections && detailsSections.length > 1) {
          // Multiple platform failures in one annotation
          for (const section of detailsSections) {
            const summaryMatch = section.match(
              /<summary>[\s\S]*?<a[^>]+><code>([^<]+)<\/code><\/a>\s*-\s*(\d+\s+\w+)\s+on\s+<a[^>]+>([\s\S]+?)<\/a>/,
            );

            if (summaryMatch) {
              const filePath = summaryMatch[1];
              const failureInfo = summaryMatch[2];
              const platformHtml = summaryMatch[3];
              const platform = platformHtml.replace(/<img[^>]+>/g, "").trim();

              const fileKey = `${filePath}|${failureInfo}`;
              if (!annotationsByFile.has(fileKey)) {
                annotationsByFile.set(fileKey, {
                  filePath,
                  failureInfo,
                  platforms: [],
                  htmlParts: [],
                  originalAnnotations: [],
                });
              }

              const entry = annotationsByFile.get(fileKey);
              entry.platforms.push(platform);
              entry.htmlParts.push(section);
              entry.originalAnnotations.push({
                ...annotation,
                html: section,
                originalHtml: html,
              });
            }
          }
        } else {
          // Single platform failure
          const summaryMatch = html.match(
            /<summary>[\s\S]*?<a[^>]+><code>([^<]+)<\/code><\/a>\s*-\s*(\d+\s+\w+)\s+on\s+<a[^>]+>([\s\S]+?)<\/a>/,
          );

          if (summaryMatch) {
            const filePath = summaryMatch[1];
            const failureInfo = summaryMatch[2];
            const platformHtml = summaryMatch[3];
            const platform = platformHtml.replace(/<img[^>]+>/g, "").trim();

            const fileKey = `${filePath}|${failureInfo}`;
            if (!annotationsByFile.has(fileKey)) {
              annotationsByFile.set(fileKey, {
                filePath,
                failureInfo,
                platforms: [],
                htmlParts: [],
                originalAnnotations: [],
              });
            }

            const entry = annotationsByFile.get(fileKey);
            entry.platforms.push(platform);
            entry.htmlParts.push(html);
            entry.originalAnnotations.push(annotation);
          } else {
            // Couldn't parse, treat as non-file annotation
            nonFileAnnotations.push(annotation);
          }
        }
      } else {
        // Non-file annotations (like "zig error")
        nonFileAnnotations.push(annotation);
      }
    }

    // Create merged annotations
    const mergedAnnotations = [];

    // Add file-based annotations
    for (const [key, entry] of annotationsByFile) {
      const { filePath, failureInfo, platforms, htmlParts, originalAnnotations } = entry;

      // If we have multiple platforms with the same content, merge them
      if (platforms.length > 1) {
        // Create context string with all platforms
        const uniquePlatforms = [...new Set(platforms)];
        const context = `${filePath} - ${failureInfo} on ${uniquePlatforms.join(", ")}`;

        // Check if all HTML parts are identical
        const firstHtml = htmlParts[0];
        const allSame = htmlParts.every(html => html === firstHtml);

        let mergedHtml = "";
        if (allSame) {
          // If all the same, just use the first one
          mergedHtml = firstHtml;
        } else {
          // If different, try to find one with the most color spans
          let bestHtml = firstHtml;
          let maxColorCount = (firstHtml.match(/term-fg/g) || []).length;

          for (const html of htmlParts) {
            const colorCount = (html.match(/term-fg/g) || []).length;
            if (colorCount > maxColorCount) {
              maxColorCount = colorCount;
              bestHtml = html;
            }
          }
          mergedHtml = bestHtml;
        }

        mergedAnnotations.push({
          context,
          html: mergedHtml,
          merged: true,
          platformCount: uniquePlatforms.length,
        });
      } else {
        // Single platform, use original
        mergedAnnotations.push(originalAnnotations[0]);
      }
    }

    // Add non-file annotations
    mergedAnnotations.push(...nonFileAnnotations);

    // Sort annotations: ones with colors at the bottom
    const annotationsWithColorInfo = mergedAnnotations.map(annotation => {
      const html = annotation.html || "";
      const hasColors = html.includes("term-fg") || html.includes("\\x1b[");
      return { annotation, hasColors };
    });

    // Sort: no colors first, then colors
    annotationsWithColorInfo.sort((a, b) => {
      if (a.hasColors === b.hasColors) return 0;
      return a.hasColors ? 1 : -1;
    });

    const sortedAnnotations = annotationsWithColorInfo.map(item => item.annotation);

    // Count failures - look for actual test counts in the content
    let totalFailures = 0;
    let totalFlaky = 0;

    // First try to count from annotations
    for (const annotation of sortedAnnotations) {
      const isFlaky = annotation.context.toLowerCase().includes("flaky");
      const html = annotation.html || "";

      // Look for patterns like "X tests failed" or "X failing"
      const failureMatches = html.match(/(\d+)\s+(tests?\s+failed|failing)/gi);
      if (failureMatches) {
        for (const match of failureMatches) {
          const count = parseInt(match.match(/\d+/)[0]);
          if (isFlaky) {
            totalFlaky += count;
          } else {
            totalFailures += count;
          }
          break; // Only count first match to avoid duplicates
        }
      } else if (!isFlaky) {
        // If no count found, count the annotation itself
        totalFailures++;
      }
    }

    // If no annotations, use job count
    if (totalFailures === 0 && failedJobs.length > 0) {
      totalFailures = failedJobs.length;
    }

    // Display failure count
    if (totalFailures > 0 || totalFlaky > 0) {
      if (totalFailures > 0) {
        console.log(`\n${colors.red}${colors.bold}${totalFailures} test failures${colors.reset}`);
      }
      if (showFlaky && totalFlaky > 0) {
        console.log(`${colors.dim}${totalFlaky} flaky tests${colors.reset}`);
      }
      console.log();
    } else if (failedJobs.length > 0) {
      console.log(`\n${colors.red}${colors.bold}${failedJobs.length} job failures${colors.reset}\n`);
    }

    // Display all annotations
    console.log();
    for (const annotation of sortedAnnotations) {
      // Skip flaky tests unless --flaky flag is set
      if (!showFlaky && annotation.context.toLowerCase().includes("flaky")) {
        continue;
      }

      // Display context header with background color
      // For merged annotations, show platform info
      if (annotation.merged && annotation.platformCount) {
        // Extract filename and failure info from context
        const contextParts = annotation.context.match(/^(.+?)\s+-\s+(.+?)\s+on\s+(.+)$/);
        if (contextParts) {
          const [, filename, failureInfo, platformsStr] = contextParts;
          const fileUrl = fileToUrl(filename);
          console.log(
            `${colors.bgBlue}${colors.white}${colors.bold} ${fileUrl} - ${failureInfo} ${colors.reset} ${colors.dim}on ${platformsStr}${colors.reset}`,
          );
        } else {
          const fileUrl = fileToUrl(annotation.context);
          console.log(`${colors.bgBlue}${colors.white}${colors.bold} ${fileUrl} ${colors.reset}`);
        }
      } else {
        // Single annotation - need to extract platform info from HTML
        const fileUrl = fileToUrl(annotation.context);

        // Try to extract platform info from the HTML for single platform tests
        const html = annotation.html || "";
        const singlePlatformMatch = html.match(
          /<summary>[\s\S]*?<a[^>]+><code>([^<]+)<\/code><\/a>\s*-\s*(\d+\s+\w+)\s+on\s+<a[^>]+>([\s\S]+?)<\/a>/,
        );

        if (singlePlatformMatch) {
          const failureInfo = singlePlatformMatch[2];
          const platformHtml = singlePlatformMatch[3];
          const platform = platformHtml.replace(/<img[^>]+>/g, "").trim();
          console.log(
            `${colors.bgBlue}${colors.white}${colors.bold} ${fileUrl} - ${failureInfo} ${colors.reset} ${colors.dim}on ${platform}${colors.reset}`,
          );
        } else {
          console.log(`${colors.bgBlue}${colors.white}${colors.bold} ${fileUrl} ${colors.reset}`);
        }
      }
      console.log();

      // Process the annotation HTML to preserve colors
      const html = annotation.html || "";

      // First unescape unicode sequences
      let unescapedHtml = html
        .replace(/\\u003c/g, "<")
        .replace(/\\u003e/g, ">")
        .replace(/\\u0026/g, "&")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\u001b/g, "\x1b"); // Unescape ANSI escape sequences

      // Handle newlines more carefully - BuildKite sometimes has actual newlines that shouldn't be there
      // Only replace \n if it's actually an escaped newline, not part of the content
      unescapedHtml = unescapedHtml.replace(/\\n/g, "\n");

      // Also handle escaped ANSI sequences that might appear as \\x1b or \033
      unescapedHtml = unescapedHtml.replace(/\\\\x1b/g, "\x1b").replace(/\\033/g, "\x1b");

      // Convert HTML with ANSI color classes to actual ANSI codes
      const termColors = {
        // Standard colors (0-7)
        "term-fg0": "\x1b[30m", // black
        "term-fg1": "\x1b[31m", // red
        "term-fg2": "\x1b[32m", // green
        "term-fg3": "\x1b[33m", // yellow
        "term-fg4": "\x1b[34m", // blue
        "term-fg5": "\x1b[35m", // magenta
        "term-fg6": "\x1b[36m", // cyan
        "term-fg7": "\x1b[37m", // white
        // Also support 30-37 format
        "term-fg30": "\x1b[30m", // black
        "term-fg31": "\x1b[31m", // red
        "term-fg32": "\x1b[32m", // green
        "term-fg33": "\x1b[33m", // yellow
        "term-fg34": "\x1b[34m", // blue
        "term-fg35": "\x1b[35m", // magenta
        "term-fg36": "\x1b[36m", // cyan
        "term-fg37": "\x1b[37m", // white
        // Bright colors with 'i' prefix
        "term-fgi90": "\x1b[90m", // bright black
        "term-fgi91": "\x1b[91m", // bright red
        "term-fgi92": "\x1b[92m", // bright green
        "term-fgi93": "\x1b[93m", // bright yellow
        "term-fgi94": "\x1b[94m", // bright blue
        "term-fgi95": "\x1b[95m", // bright magenta
        "term-fgi96": "\x1b[96m", // bright cyan
        "term-fgi97": "\x1b[97m", // bright white
        // Also support without 'i'
        "term-fg90": "\x1b[90m", // bright black
        "term-fg91": "\x1b[91m", // bright red
        "term-fg92": "\x1b[92m", // bright green
        "term-fg93": "\x1b[93m", // bright yellow
        "term-fg94": "\x1b[94m", // bright blue
        "term-fg95": "\x1b[95m", // bright magenta
        "term-fg96": "\x1b[96m", // bright cyan
        "term-fg97": "\x1b[97m", // bright white
        // Background colors
        "term-bg40": "\x1b[40m", // black
        "term-bg41": "\x1b[41m", // red
        "term-bg42": "\x1b[42m", // green
        "term-bg43": "\x1b[43m", // yellow
        "term-bg44": "\x1b[44m", // blue
        "term-bg45": "\x1b[45m", // magenta
        "term-bg46": "\x1b[46m", // cyan
        "term-bg47": "\x1b[47m", // white
        // Text styles
        "term-bold": "\x1b[1m",
        "term-dim": "\x1b[2m",
        "term-italic": "\x1b[3m",
        "term-underline": "\x1b[4m",
      };

      let text = unescapedHtml;

      // Convert color spans to ANSI codes if TTY
      if (isTTY) {
        // Convert spans with color classes to ANSI codes
        for (const [className, ansiCode] of Object.entries(termColors)) {
          // Match spans that contain the class name (might have multiple classes)
          // Need to handle both formats: <span class="..."> and <span ... class="...">
          const regex = new RegExp(`<span[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</span>`, "g");
          text = text.replace(regex, (match, content) => {
            // Don't add reset if the content already has ANSI codes
            if (content.includes("\x1b[")) {
              return `${ansiCode}${content}`;
            }
            return `${ansiCode}${content}${colors.reset}`;
          });
        }
      }

      // Check if we already have ANSI codes in the text after processing
      const hasExistingAnsi = text.includes("\x1b[");

      // Check for broken color patterns (single characters wrapped in colors)
      // If we see patterns like green[, red text, green], it's likely broken
      // Also check for patterns like: green[, then reset, then text, then red text, then reset, then green]
      const hasBrokenColors =
        text.includes("\x1b[32m[") ||
        text.includes("\x1b[32m]") ||
        (text.includes("\x1b[32m✓") && text.includes("\x1b[31m") && text.includes("ms]"));

      if (hasBrokenColors) {
        // Remove all ANSI codes if the coloring looks broken
        text = text.replace(/\x1b\[[0-9;]*m/g, "");
      }

      // Remove all HTML tags, but be careful with existing ANSI codes
      text = text
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, "$1")
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<\/p>/g, "\n")
        .replace(/<p>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\u00A0/g, " ") // Non-breaking space
        .trim();

      // Remove excessive blank lines - be more aggressive
      text = text.replace(/\n\s*\n\s*\n+/g, "\n\n"); // Replace 3+ newlines with 2
      text = text.replace(/\n\s*\n/g, "\n"); // Replace 2 newlines with 1

      // For zig error annotations, check if there are multiple platform sections
      let handled = false;
      if (annotation.context.includes("zig error")) {
        // Split by platform headers within the content
        const platformSections = text.split(/(?=^\s*[^\s\/]+\.zig\s*-\s*zig error\s+on\s+)/m);

        if (platformSections.length > 1) {
          // Skip the first empty section if it exists
          const sections = platformSections.filter(s => s.trim());

          if (sections.length > 1) {
            // We have multiple platform errors in one annotation
            // Extract unique platform names
            const platforms = [];
            for (const section of sections) {
              const platformMatch = section.match(/on\s+(\S+)/);
              if (platformMatch) {
                platforms.push(platformMatch[1]);
              }
            }

            // Show combined header with background color
            const filename = annotation.context;
            const fileUrl = fileToUrl(filename);
            const platformText = platforms.join(", ");
            console.log(
              `${colors.bgRed}${colors.white}${colors.bold} ${fileUrl} ${colors.reset} ${colors.dim}on ${platformText}${colors.reset}`,
            );
            console.log();

            // Show only the first error detail (they're the same)
            const firstError = sections[0];
            const errorLines = firstError.split("\n");

            // Skip the platform-specific header line and remove excessive blank lines
            let previousWasBlank = false;
            for (let i = 0; i < errorLines.length; i++) {
              const line = errorLines[i];
              if (i === 0 && line.match(/\.zig\s*-\s*zig error\s+on\s+/)) {
                continue; // Skip platform header
              }

              // Skip multiple consecutive blank lines
              const isBlank = line.trim() === "";
              if (isBlank && previousWasBlank) {
                continue;
              }
              previousWasBlank = isBlank;

              console.log(line); // No indentation
            }
            console.log();
            handled = true;
          }
        }
      }

      // Normal processing for other annotations
      if (!handled) {
        // For merged annotations, skip the duplicate headers within the content
        const isMerged = annotation.merged || (annotation.platformCount && annotation.platformCount > 1);

        // Process lines, removing excessive blank lines
        let previousWasBlank = false;
        text.split("\n").forEach((line, index) => {
          // For merged annotations, skip duplicate platform headers
          if (
            isMerged &&
            index > 0 &&
            line.match(/^[^\s\/]+\.(ts|js|tsx|jsx|zig)\s*-\s*\d+\s+(failing|errors?|warnings?)\s+on\s+/)
          ) {
            return; // Skip duplicate headers in merged content
          }

          // Skip multiple consecutive blank lines
          const isBlank = line.trim() === "";
          if (isBlank && previousWasBlank) {
            return;
          }
          previousWasBlank = isBlank;

          console.log(line); // No indentation
        });
        console.log();
      }
    }
  } catch (e) {
    console.error("Failed to parse annotations:", e);
    console.log("\nView detailed results at:");
    console.log(`  https://buildkite.com/bun/bun/builds/${buildNumber}#annotations`);
  }
} else {
  // No annotations found - show detailed job failure information
  if (failedJobs.length > 0) {
    console.log(`\n${colors.red}${colors.bold}${failedJobs.length} job failures${colors.reset}\n`);

    // Show annotation counts if available
    const annotationCounts = build.annotation_counts_by_style;
    if (annotationCounts) {
      const errors = annotationCounts.error || 0;
      const warnings = annotationCounts.warning || 0;
      if (errors > 0 || warnings > 0) {
        const parts = [];
        if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
        if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
        console.log(
          `${colors.dim}Annotations: ${parts.join(", ")} - view at https://buildkite.com/bun/bun/builds/${buildNumber}#annotations${colors.reset}\n`,
        );
      }
    }

    // Group jobs by type
    const buildJobs = failedJobs.filter(job => (job.name || job.label || "").includes("build-"));
    const testJobs = failedJobs.filter(job => (job.name || job.label || "").includes("test"));
    const otherJobs = failedJobs.filter(
      job => !(job.name || job.label || "").includes("build-") && !(job.name || job.label || "").includes("test"),
    );

    // Display build failures
    if (buildJobs.length > 0) {
      console.log(
        `${colors.bgRed}${colors.white}${colors.bold} Build Failures (${buildJobs.length}) ${colors.reset}\n`,
      );
      for (const job of buildJobs) {
        const name = (job.name || job.label || "Unknown").replace(/^:([^:]+):/, (_, emoji) => {
          const platform = emoji.toLowerCase();
          return platformMap[platform] || `:${emoji}:`;
        });
        const duration =
          job.started_at && job.finished_at
            ? `${((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000).toFixed(0)}s`
            : "N/A";
        console.log(`  ${colors.red}✗${colors.reset} ${name}`);
        console.log(`    ${colors.dim}Duration: ${duration} | Exit: ${job.exit_status}${colors.reset}`);
        console.log(`    ${colors.dim}https://buildkite.com${job.path}${colors.reset}`);
        console.log();
      }
    }

    // Display test failures
    if (testJobs.length > 0) {
      console.log(`${colors.bgBlue}${colors.white}${colors.bold} Test Failures (${testJobs.length}) ${colors.reset}\n`);
      for (const job of testJobs) {
        const name = (job.name || job.label || "Unknown").replace(/^:([^:]+):/, (_, emoji) => {
          const platform = emoji.toLowerCase();
          return platformMap[platform] || `:${emoji}:`;
        });
        const duration =
          job.started_at && job.finished_at
            ? `${((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000).toFixed(0)}s`
            : "N/A";
        console.log(`  ${colors.red}✗${colors.reset} ${name}`);
        console.log(`    ${colors.dim}Duration: ${duration} | Exit: ${job.exit_status}${colors.reset}`);
        console.log(`    ${colors.dim}https://buildkite.com${job.path}${colors.reset}`);
        console.log();
      }
    }

    // Display other failures
    if (otherJobs.length > 0) {
      console.log(
        `${colors.bgBlue}${colors.white}${colors.bold} Other Failures (${otherJobs.length}) ${colors.reset}\n`,
      );
      for (const job of otherJobs) {
        const name = (job.name || job.label || "Unknown").replace(/^:([^:]+):/, (_, emoji) => {
          const platform = emoji.toLowerCase();
          return platformMap[platform] || `:${emoji}:`;
        });
        const duration =
          job.started_at && job.finished_at
            ? `${((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000).toFixed(0)}s`
            : "N/A";
        console.log(`  ${colors.red}✗${colors.reset} ${name}`);
        console.log(`    ${colors.dim}Duration: ${duration} | Exit: ${job.exit_status}${colors.reset}`);
        console.log(`    ${colors.dim}https://buildkite.com${job.path}${colors.reset}`);
        console.log();
      }
    }

    // Fetch and display logs for all failed jobs
    // Use the public BuildKite log endpoint
    console.log(`${colors.dim}Fetching logs for ${failedJobs.length} failed jobs...${colors.reset}\n`);

    for (const job of failedJobs) {
      const name = (job.name || job.label || "Unknown").replace(/^:([^:]+):/, (_, emoji) => {
        const platform = emoji.toLowerCase();
        return platformMap[platform] || `:${emoji}:`;
      });

      // Create a sanitized filename from the job name
      // e.g., ":darwin: aarch64 - build-cpp" -> "darwin-aarch64-build-cpp"
      const sanitizedName = (job.name || job.label || "unknown")
        .replace(/^:([^:]+):\s*/, "$1-") // :darwin: -> darwin-
        .replace(/\s+-\s+/g, "-") // " - " -> "-"
        .replace(/[^a-zA-Z0-9-]/g, "-") // Replace other chars with -
        .replace(/-+/g, "-") // Collapse multiple -
        .replace(/^-|-$/g, "") // Remove leading/trailing -
        .toLowerCase();

      const logFilePath = `/tmp/bun-build-${buildNumber}-${sanitizedName}.log`;

      try {
        const logResponse = await fetch(
          `https://buildkite.com/organizations/bun/pipelines/bun/builds/${buildNumber}/jobs/${job.id}/log`,
        );

        if (logResponse.ok) {
          const logData = await logResponse.json();
          let output = logData.output || "";

          // Convert HTML to readable text (without ANSI codes for file output)
          const plainOutput = output
            // Remove timestamp tags
            .replace(/<time[^>]*>[^<]*<\/time>/g, "")
            // Remove all span tags
            .replace(/<span[^>]*>([^<]*)<\/span>/g, "$1")
            // Remove remaining HTML tags
            .replace(/<[^>]+>/g, "")
            // Decode HTML entities
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#47;/g, "/")
            .replace(/&nbsp;/g, " ");

          // Write the full log to a file
          await Bun.write(logFilePath, plainOutput);

          // Extract unique error messages for display
          const lines = plainOutput.split("\n");
          const uniqueErrors = new Set<string>();

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Look for actual error messages
            const isError =
              (line.includes("error:") && !line.includes('error: script "') && !line.includes("error: exit")) ||
              line.includes("fatal error:") ||
              line.includes("panic:") ||
              line.includes("undefined reference");

            if (isError) {
              // Extract just the error message part (remove path prefixes and timestamps)
              const errorMsg = line
                .replace(/^.*?\d{4}-\d{2}-\d{2}T[\d:.]+Z/, "") // Remove timestamps
                .replace(/^.*?\/[^\s]*:\d+:\d+:\s*/, "") // Remove file paths
                .trim();

              if (errorMsg && !uniqueErrors.has(errorMsg)) {
                uniqueErrors.add(errorMsg);
              }
            }
          }

          // Display job info with log file path
          console.log(`${colors.bgBlue}${colors.white}${colors.bold} ${name} ${colors.reset}`);
          console.log(`  ${colors.dim}Log: ${logFilePath}${colors.reset}`);

          if (uniqueErrors.size > 0) {
            console.log(`  ${colors.red}Errors (${uniqueErrors.size}):${colors.reset}`);
            let count = 0;
            for (const err of uniqueErrors) {
              if (count >= 5) {
                console.log(`    ${colors.dim}... and ${uniqueErrors.size - 5} more${colors.reset}`);
                break;
              }
              console.log(`    ${colors.red}•${colors.reset} ${err.slice(0, 120)}${err.length > 120 ? "..." : ""}`);
              count++;
            }
          } else {
            // Show last few lines as a preview
            const lastLines = lines.slice(-5).filter(l => l.trim());
            if (lastLines.length > 0) {
              console.log(`  ${colors.dim}Last output:${colors.reset}`);
              for (const line of lastLines) {
                console.log(`    ${colors.dim}${line.slice(0, 100)}${line.length > 100 ? "..." : ""}${colors.reset}`);
              }
            }
          }

          if (logData.truncated) {
            console.log(`  ${colors.dim}(Log was truncated by BuildKite)${colors.reset}`);
          }
        } else {
          console.log(`${colors.bgBlue}${colors.white}${colors.bold} ${name} ${colors.reset}`);
          console.log(`  ${colors.dim}Failed to fetch log: ${logResponse.status}${colors.reset}`);
        }
      } catch (e) {
        console.log(`${colors.bgBlue}${colors.white}${colors.bold} ${name} ${colors.reset}`);
        console.log(`  ${colors.dim}Error fetching log: ${e.message}${colors.reset}`);
      }
      console.log();
    }
  } else {
    console.log("View detailed results at:");
    console.log(`  https://buildkite.com/bun/bun/builds/${buildNumber}#annotations`);
  }
}
