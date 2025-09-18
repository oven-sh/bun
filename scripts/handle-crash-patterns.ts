#!/usr/bin/env bun

const body = process.env.GITHUB_ISSUE_BODY || "";
const title = process.env.GITHUB_ISSUE_TITLE || "";
const issueNumber = process.env.GITHUB_ISSUE_NUMBER;

if (!issueNumber) {
  throw new Error("GITHUB_ISSUE_NUMBER must be set");
}

interface CloseAction {
  reason: "not_planned" | "completed";
  comment: string;
}

let closeAction: CloseAction | null = null;

// Check for workers_terminated
if (body.includes("workers_terminated")) {
  closeAction = {
    reason: "not_planned",
    comment: `Duplicate of #15964
We are tracking worker stability issues in https://github.com/oven-sh/bun/issues/15964. For now, I recommend against terminating workers when possible.`,
  };
}

// Check for better-sqlite3 with RunCommand or AutoCommand
else if (body.includes("better-sqlite3") && (body.includes("[RunCommand]") || body.includes("[AutoCommand]"))) {
  closeAction = {
    reason: "not_planned",
    comment: `Duplicate of #4290.
better-sqlite3 is not supported yet in Bun due to missing V8 C++ APIs. For now, you can try [bun:sqlite](https://bun.com/docs/api/sqlite) for an almost drop-in replacement.`,
  };
}

// Check for CPU architecture issues (Segmentation Fault/Illegal Instruction with no_avx)
else if (
  (body.includes("Segmentation Fault") ||
    body.includes("Illegal Instruction") ||
    body.includes("IllegalInstruction")) &&
  body.includes("no_avx")
) {
  let comment = `Bun requires a CPU with the micro-architecture [\`nehalem\`](https://en.wikipedia.org/wiki/Nehalem_(microarchitecture)) or later (released in 2008). If you're using a CPU emulator like qemu, then try enabling x86-64-v2.`;

  // Check if it's macOS
  const platformMatch = body.match(/Platform:\s*([^\n]+)/i) || body.match(/on\s+(macos|darwin)/i);
  const isMacOS =
    platformMatch &&
    (platformMatch[1]?.toLowerCase().includes("darwin") || platformMatch[1]?.toLowerCase().includes("macos"));

  if (isMacOS) {
    comment += `\n\nIf you're on a macOS silicon device, you're running Bun via the Rosetta CPU emulator and your best option is to run Bun natively instead.`;
  }

  closeAction = {
    reason: "not_planned",
    comment,
  };
}

if (closeAction) {
  // Output the action to take
  console.write(
    JSON.stringify({
      close: true,
      reason: closeAction.reason,
      comment: closeAction.comment,
    }),
  );
} else {
  console.write(JSON.stringify({ close: false }));
}
