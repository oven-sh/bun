#!/usr/bin/env bun
/**
 * Trace Analysis Tool
 *
 * This example demonstrates how to analyze trace files to understand
 * application behavior. This is especially useful for AI agents trying
 * to debug or understand unfamiliar codebases.
 *
 * Usage:
 *   bun --trace=app.jsonl my-app.js
 *   bun trace-analysis.js app.jsonl
 */

import { readFileSync } from "fs";

const traceFile = process.argv[2];
if (!traceFile) {
  console.error("Usage: bun trace-analysis.js <trace-file>");
  console.error("\nExample:");
  console.error("  bun --trace=app.jsonl my-app.js");
  console.error("  bun trace-analysis.js app.jsonl");
  process.exit(1);
}

// Parse trace file
const content = readFileSync(traceFile, "utf8");
const events = content
  .trim()
  .split("\n")
  .filter(l => l.length > 0)
  .map(l => JSON.parse(l));

if (events.length === 0) {
  console.error("No trace events found in file");
  process.exit(1);
}

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║               TRACE ANALYSIS REPORT                            ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

// ============================================================================
// TIMELINE
// ============================================================================

console.log("📊 TIMELINE");
console.log("─────────────────────────────────────────────────────────────────");
const startTime = events[0]?.ts || 0;
const endTime = events[events.length - 1]?.ts || 0;
const duration = endTime - startTime;

console.log(`Start time:  ${new Date(startTime).toISOString()}`);
console.log(`End time:    ${new Date(endTime).toISOString()}`);
console.log(`Duration:    ${duration}ms (${(duration / 1000).toFixed(2)}s)\n`);

// Show timeline of key events
console.log("Key events:");
const keyEvents = events.filter(e => {
  // Show operation completions (exit traces)
  return (
    e[3].bytes_read !== undefined ||
    e[3].bytes_written !== undefined ||
    e[3].status !== undefined ||
    e[3].success !== undefined ||
    e[3].size !== undefined
  );
});

keyEvents.slice(0, 10).forEach(e => {
  const elapsed = ((e[1] - startTime) / 1000).toFixed(3);
  const icon =
    {
      fs: "📁",
      fetch: "🌐",
      response_body: "📄",
      bun_write: "✍️",
    }[e[0]] || "•";

  let summary = `${icon} [+${elapsed}s] ${e[0]}.${e[2]}`;

  // Add context
  if (e[3].path) summary += ` ${e[3].path}`;
  if (e[3].url) summary += ` ${e[3].url}`;
  if (e[3].bytes_read) summary += ` (read ${e[3].bytes_read}B)`;
  if (e[3].bytes_written) summary += ` (wrote ${e[3].bytes_written}B)`;
  if (e[3].size) summary += ` (${e[3].size}B)`;
  if (e[3].status) summary += ` [${e[3].status}]`;

  console.log(`  ${summary}`);
});

if (keyEvents.length > 10) {
  console.log(`  ... and ${keyEvents.length - 10} more events`);
}
console.log();

// ============================================================================
// SUMMARY BY NAMESPACE
// ============================================================================

console.log("📈 OPERATIONS BY NAMESPACE");
console.log("─────────────────────────────────────────────────────────────────");
const byNs = {};
events.forEach(e => {
  if (!byNs[e[0]]) byNs[e[0]] = { total: 0, operations: {} };
  byNs[e[0]].total++;
  byNs[e[0]].operations[e[2]] = (byNs[e[0]].operations[e[2]] || 0) + 1;
});

Object.entries(byNs).forEach(([ns, data]) => {
  console.log(`\n${ns}: ${data.total} events`);
  Object.entries(data.operations)
    .sort((a, b) => b[1] - a[1])
    .forEach(([op, count]) => {
      const bar = "█".repeat(Math.min(count, 40));
      console.log(`  ${op.padEnd(20)} ${bar} ${count}`);
    });
});
console.log();

// ============================================================================
// FILE SYSTEM ANALYSIS
// ============================================================================

const fsEvents = events.filter(e => e[0] === "fs");
if (fsEvents.length > 0) {
  console.log("📁 FILE SYSTEM ANALYSIS");
  console.log("─────────────────────────────────────────────────────────────────");

  // Files accessed
  const filesRead = new Set();
  const filesWritten = new Set();
  const filesStatted = new Set();

  fsEvents.forEach(e => {
    if (e[3].path) {
      if (e[2] === "readFile" || e[2] === "read") {
        filesRead.add(e[3].path);
      }
      if (e[2] === "writeFile" || e[2] === "write") {
        filesWritten.add(e[3].path);
      }
      if (e[2] === "stat" || e[2] === "lstat") {
        filesStatted.add(e[3].path);
      }
    }
  });

  console.log(`Files read:    ${filesRead.size}`);
  if (filesRead.size <= 10) {
    filesRead.forEach(f => console.log(`  • ${f}`));
  } else {
    Array.from(filesRead)
      .slice(0, 10)
      .forEach(f => console.log(`  • ${f}`));
    console.log(`  ... and ${filesRead.size - 10} more`);
  }

  console.log(`\nFiles written: ${filesWritten.size}`);
  if (filesWritten.size <= 10) {
    filesWritten.forEach(f => console.log(`  • ${f}`));
  } else {
    Array.from(filesWritten)
      .slice(0, 10)
      .forEach(f => console.log(`  • ${f}`));
    console.log(`  ... and ${filesWritten.size - 10} more`);
  }

  // Bytes transferred
  let totalBytesRead = 0;
  let totalBytesWritten = 0;

  fsEvents.forEach(e => {
    if (e[3].bytes_read) totalBytesRead += e[3].bytes_read;
    if (e[3].bytes_written) totalBytesWritten += e[3].bytes_written;
  });

  console.log(`\nData transfer:`);
  console.log(`  Bytes read:    ${totalBytesRead.toLocaleString()} (${formatBytes(totalBytesRead)})`);
  console.log(`  Bytes written: ${totalBytesWritten.toLocaleString()} (${formatBytes(totalBytesWritten)})`);

  // Directory operations
  const dirOps = fsEvents.filter(e => ["mkdir", "rmdir", "readdir"].includes(e[2]));
  if (dirOps.length > 0) {
    console.log(`\nDirectory operations: ${dirOps.length}`);
    const dirs = new Set(dirOps.map(e => e[3].path).filter(Boolean));
    dirs.forEach(d => console.log(`  • ${d}`));
  }

  console.log();
}

// ============================================================================
// HTTP ANALYSIS
// ============================================================================

const fetchEvents = events.filter(e => e[0] === "fetch");
if (fetchEvents.length > 0) {
  console.log("🌐 HTTP ANALYSIS");
  console.log("─────────────────────────────────────────────────────────────────");

  const requests = fetchEvents.filter(e => e[2] === "request");
  const responses = fetchEvents.filter(e => e[2] === "response");

  console.log(`Total requests:  ${requests.length}`);
  console.log(`Total responses: ${responses.length}\n`);

  // Group by URL
  const byUrl = {};
  requests.forEach(r => {
    if (!byUrl[r[3].url]) {
      byUrl[r[3].url] = { requests: 0, method: r[3].method, responses: [] };
    }
    byUrl[r[3].url].requests++;
  });

  responses.forEach(r => {
    if (byUrl[r[3].url]) {
      byUrl[r[3].url].responses.push(r);
    }
  });

  console.log("Endpoints:");
  Object.entries(byUrl).forEach(([url, data]) => {
    console.log(`  ${data.method} ${url}`);
    console.log(`    Requests:  ${data.requests}`);
    console.log(`    Responses: ${data.responses.length}`);

    if (data.responses.length > 0) {
      const statuses = data.responses.map(r => r[3].status || "error");
      const statusCounts = {};
      statuses.forEach(s => {
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`      ${status}: ${count}`);
      });

      const totalBytes = data.responses.reduce((sum, r) => sum + (r[3].body_size || 0), 0);
      console.log(`      Total bytes: ${totalBytes.toLocaleString()} (${formatBytes(totalBytes)})`);
    }

    // Calculate timing
    const reqTimes = requests.filter(r => r[3].url === url).map(r => r[1]);
    const respTimes = data.responses.map(r => r[1]);
    if (reqTimes.length > 0 && respTimes.length > 0) {
      const avgLatency =
        respTimes.reduce((sum, rt, i) => {
          if (reqTimes[i]) return sum + (rt - reqTimes[i]);
          return sum;
        }, 0) / Math.min(reqTimes.length, respTimes.length);
      console.log(`      Avg latency: ${avgLatency.toFixed(0)}ms`);
    }
    console.log();
  });
}

// ============================================================================
// PERFORMANCE INSIGHTS
// ============================================================================

console.log("⚡ PERFORMANCE INSIGHTS");
console.log("─────────────────────────────────────────────────────────────────");

// Find slowest operations
const operationPairs = new Map();
events.forEach((e, i) => {
  const key = `${e[0]}.${e[2]}.${e[3].path || e[3].url || ""}`;

  if (!operationPairs.has(key)) {
    operationPairs.set(key, { start: e[1], events: [e] });
  } else {
    const pair = operationPairs.get(key);
    pair.events.push(e);
    pair.end = e[1];
  }
});

const slowOps = Array.from(operationPairs.entries())
  .map(([k, v]) => ({
    op: k,
    duration: v.end ? v.end - v.start : 0,
    events: v.events,
  }))
  .filter(x => x.duration > 0)
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 10);

if (slowOps.length > 0) {
  console.log("Slowest operations:");
  slowOps.forEach(op => {
    console.log(`  ${op.op}`);
    console.log(`    Duration: ${op.duration}ms`);
  });
} else {
  console.log("No slow operations detected (all operations completed quickly)");
}

console.log();

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

console.log("💡 RECOMMENDATIONS");
console.log("─────────────────────────────────────────────────────────────────");

const recommendations = [];

// Check for excessive file operations
if (fsEvents.length > 100) {
  recommendations.push(`High number of file operations (${fsEvents.length}). Consider batching or caching.`);
}

// Check for repeated reads of same file
const readCounts = {};
fsEvents
  .filter(e => e[2] === "readFile")
  .forEach(e => {
    readCounts[e[3].path] = (readCounts[e[3].path] || 0) + 1;
  });
const repeatedReads = Object.entries(readCounts).filter(([_, count]) => count > 3);
if (repeatedReads.length > 0) {
  recommendations.push(`Repeated reads of same files: ${repeatedReads.map(([f, c]) => `${f} (${c}x)`).join(", ")}`);
}

// Check for HTTP requests in loops
if (fetchEvents.length > 10) {
  const urls = fetchEvents.filter(e => e[2] === "request").map(e => e[3].url);
  const urlCounts = {};
  urls.forEach(u => {
    urlCounts[u] = (urlCounts[u] || 0) + 1;
  });
  const repeatedRequests = Object.entries(urlCounts).filter(([_, count]) => count > 5);
  if (repeatedRequests.length > 0) {
    recommendations.push(
      `Repeated HTTP requests detected. Consider caching: ${repeatedRequests.map(([u, c]) => `${u} (${c}x)`).join(", ")}`,
    );
  }
}

if (recommendations.length > 0) {
  recommendations.forEach(r => console.log(`  • ${r}`));
} else {
  console.log("  No obvious performance issues detected. Good job! ✓");
}

console.log();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}
