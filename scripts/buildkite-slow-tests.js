#!/usr/bin/env bun

import { readFileSync } from "fs";

function parseLogFile(filename) {
  const testDetails = new Map(); // Track individual attempts and total for each test
  let currentTest = null;
  let startTime = null;

  // Pattern to match test group start: --- [90m[N/TOTAL][0m test/path
  // Note: there are escape sequences before _bk
  const startPattern = /_bk;t=(\d+).*?--- .*?\[90m\[(\d+)\/(\d+)\].*?\[0m (.+)/;

  const content = readFileSync(filename, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(startPattern);
    if (match) {
      // If we have a previous test, calculate its duration
      if (currentTest && startTime) {
        const endTime = parseInt(match[1]);
        const duration = endTime - startTime;

        // Extract attempt info - match the actual ANSI pattern
        const attemptMatch = currentTest.match(/\s+\x1b\[90m\[attempt #(\d+)\]\x1b\[0m$/);
        const cleanName = currentTest.replace(/\s+\x1b\[90m\[attempt #\d+\]\x1b\[0m$/, "").trim();
        const attemptNum = attemptMatch ? parseInt(attemptMatch[1]) : 1;

        if (!testDetails.has(cleanName)) {
          testDetails.set(cleanName, { total: 0, attempts: [] });
        }

        const testInfo = testDetails.get(cleanName);
        testInfo.total += duration;
        testInfo.attempts.push({ attempt: attemptNum, duration });
      }

      // Start new test
      startTime = parseInt(match[1]);
      currentTest = match[4].trim();
    }
  }

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
