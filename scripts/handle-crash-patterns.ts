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

// Compute lowercase once for performance
const bodyLower = body.toLowerCase();

// Check for workers_terminated
if (bodyLower.includes("workers_terminated")) {
  closeAction = {
    reason: "not_planned",
    comment: `Duplicate of #15964
We are tracking worker stability issues in https://github.com/oven-sh/bun/issues/15964. For now, I recommend against terminating workers when possible.`,
  };
}

// Check for better-sqlite3 with RunCommand or AutoCommand
else if (
  bodyLower.includes("better-sqlite3") &&
  (bodyLower.includes("runcommand") || bodyLower.includes("autocommand"))
) {
  closeAction = {
    reason: "not_planned",
    comment: `Duplicate of #4290.
better-sqlite3 is not supported yet in Bun due to missing V8 C++ APIs. For now, you can try [bun:sqlite](https://bun.com/docs/api/sqlite) for an almost drop-in replacement.`,
  };
}

// Check for ENOTCONN with Transport and standalone_executable on v1.2.23
else if (
  bodyLower.includes("enotconn") &&
  bodyLower.includes("transport") &&
  bodyLower.includes("standalone_executable") &&
  /\bv?1\.2\.23\b/i.test(bodyLower)
) {
  closeAction = {
    reason: "completed",
    comment: `Duplicate of #23342.
This issue was fixed in Bun v1.3. Please upgrade to the latest version:

\`\`\`sh
bun upgrade
\`\`\``,
  };
}

// Check for WASM IPInt 32 stack traces - be very specific to avoid false positives
else if (bodyLower.includes("wasm_trampoline_wasm_ipint_call_wide32")) {
  closeAction = {
    reason: "not_planned",
    comment: `Duplicate of #17841.
This is a known issue with JavaScriptCore's WASM In-place interpreter on Linux x64. You can work around it by:

1. Setting \`BUN_JSC_useWasmIPInt=0\` to disable IPInt (reverts to older Wasm interpreter)
2. Using an aarch64 CPU instead of x86_64
3. Using \`BUN_JSC_jitPolicyScale=0\` to force JIT compilation (may impact startup performance)

We've reported this to WebKit and are tracking the issue in #17841.`,
  };
}

// Check for CPU architecture issues (Segmentation Fault/Illegal Instruction with no_avx)
else if (
  (bodyLower.includes("segmentation fault") ||
    bodyLower.includes("illegal instruction") ||
    bodyLower.includes("illegalinstruction")) &&
  bodyLower.includes("no_avx")
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
