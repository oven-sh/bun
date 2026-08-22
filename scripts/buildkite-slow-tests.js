#!/usr/bin/env bun

import { readFileSync } from "fs";

function parseLogFile(filename) {
  const testDetails = new Map(); // Track individual attempts and total for each test
  let currentTest = null;
  let currentAttempt = 1;
  let startTime = null;
  let lastTs = null;

  const content = readFileSync(filename, "utf-8").replace(/\x1b\[[0-9;]*m/g, "");

  const record = (name, attempt, duration) => {
    const cleanName = name.replace(/\\/g, "/");
    if (!testDetails.has(cleanName)) testDetails.set(cleanName, { total: 0, attempts: [] });
    const testInfo = testDetails.get(cleanName);
    testInfo.total += duration;
    testInfo.attempts.push({ attempt, duration });
  };
  const close = ts => {
    if (currentTest === null || startTime === null) return;
    record(currentTest, currentAttempt, ts - startTime);
    currentTest = null;
    startTime = null;
  };

  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r+$/, "");
    const m = /^\x1b?_bk;t=(\d+)\x07(.*)$/.exec(line);
    if (!m) continue;
    const ts = (lastTs = parseInt(m[1], 10));
    const body = m[2];

    const hdr = /^--- \[\d+\/\d+\] (.+)$/.exec(body);
    if (hdr) {
      close(ts);
      const attemptMatch = hdr[1].match(/\s+\[attempt #(\d+)\]\s*$/);
      const title = hdr[1].replace(/\s+\[attempt #\d+\]\s*$/, "").trim();
      // Retry/error headers (`title - code 1`) close the run but do not start one.
      if (!/\.(?:[cm]?[jt]sx?|json)$/.test(title)) continue;
      currentTest = title;
      currentAttempt = attemptMatch ? parseInt(attemptMatch[1], 10) : 1;
      startTime = ts;
      continue;
    }
    // Parallel-bucket summary lines carry their own wall-clock.
    const timed = /^\[\d+\/\d+\] (.+\.(?:[cm]?[jt]sx?|json)) \((\d+(?:\.\d+)?)s\)$/.exec(body);
    if (timed) {
      close(ts);
      record(timed[1].trim(), 1, Math.round(parseFloat(timed[2]) * 1000));
      continue;
    }
    // Non-[N/M] phase headers (napi prebuild, `[A-B/M] K files in parallel`,
    // `Running N parallel-safe ...`, End) close the open timer so the
    // preceding serial test is not charged for the batch that follows.
    // Limited to the titles runner.node.mjs actually emits so a stray
    // `--- a/<file>` diff line in test stdout does not truncate a span.
    if (
      /^--- (?:\[\d+-\d+\/\d+\]|napi prebuild:|Running \d+ parallel-safe|End\b|Summary\b|Received \w+, exiting)/.test(
        body,
      )
    ) {
      close(ts);
    }
  }
  // A truncated log (job killed / timed out mid-run) has no `--- End`; charge
  // the open span to the last timestamp seen so the culprit is not dropped.
  if (lastTs !== null) close(lastTs);

  // Convert to array and sort by total duration
  const testGroups = Array.from(testDetails.entries())
    .map(([name, info]) => ({
      name,
      totalDuration: info.total,
      attempts: info.attempts.sort((a, b) => a.attempt - b.attempt),
    }))
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return testGroups;
}

function formatAttempts(attempts) {
  if (attempts.length <= 1) return "";

  const attemptStrings = attempts.map(
    ({ attempt, duration }) => `${(duration / 1000).toFixed(1)}s attempt #${attempt}`,
  );
  return ` [${attemptStrings.join(", ")}]`;
}

if (process.argv.length !== 3) {
  console.log("Usage: bun parse_test_logs.js <log_file>");
  process.exit(1);
}

const filename = process.argv[2];
const testGroups = parseLogFile(filename);

const totalTime = testGroups.reduce((sum, group) => sum + group.totalDuration, 0) / 1000;
const avgTime = testGroups.length > 0 ? totalTime / testGroups.length : 0;

console.log(
  `## Slowest Tests Analysis - ${testGroups.length} tests (${totalTime.toFixed(1)}s total, ${avgTime.toFixed(2)}s avg)`,
);
console.log("");

// Top 10 summary
console.log("**Top 10 slowest tests:**");
for (let i = 0; i < Math.min(10, testGroups.length); i++) {
  const { name, totalDuration, attempts } = testGroups[i];
  const durationSec = totalDuration / 1000;
  const testName = name.replace("test/", "").replace(".test.ts", "").replace(".test.js", "");
  const attemptInfo = formatAttempts(attempts);
  console.log(`- **${durationSec.toFixed(1)}s** ${testName}${attemptInfo}`);
}

console.log("");

// Filter tests > 1 second
const slowTests = testGroups.filter(test => test.totalDuration > 1000);

console.log("```");
console.log(`All tests > 1s (${slowTests.length} tests):`);

for (let i = 0; i < slowTests.length; i++) {
  const { name, totalDuration, attempts } = slowTests[i];
  const durationSec = totalDuration / 1000;
  const attemptInfo = formatAttempts(attempts);
  console.log(`${(i + 1).toString().padStart(3)}. ${durationSec.toFixed(2).padStart(7)}s  ${name}${attemptInfo}`);
}

console.log("```");
