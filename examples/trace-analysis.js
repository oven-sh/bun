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
    e.data.bytes_read !== undefined ||
    e.data.bytes_written !== undefined ||
    e.data.status !== undefined ||
    e.data.success !== undefined ||
    e.data.size !== undefined
  );
});

keyEvents.slice(0, 10).forEach(e => {
  const elapsed = ((e.ts - startTime) / 1000).toFixed(3);
  const icon =
    {
      fs: "📁",
      fetch: "🌐",
      response_body: "📄",
      bun_write: "✍️",
    }[e.ns] || "•";

  let summary = `${icon} [+${elapsed}s] ${e.ns}.${e.data.call}`;

  // Add context
  if (e.data.path) summary += ` ${e.data.path}`;
  if (e.data.url) summary += ` ${e.data.url}`;
  if (e.data.bytes_read) summary += ` (read ${e.data.bytes_read}B)`;
  if (e.data.bytes_written) summary += ` (wrote ${e.data.bytes_written}B)`;
  if (e.data.size) summary += ` (${e.data.size}B)`;
  if (e.data.status) summary += ` [${e.data.status}]`;

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
  if (!byNs[e.ns]) byNs[e.ns] = { total: 0, operations: {} };
  byNs[e.ns].total++;
  byNs[e.ns].operations[e.data.call] = (byNs[e.ns].operations[e.data.call] || 0) + 1;
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

const fsEvents = events.filter(e => e.ns === "fs");
if (fsEvents.length > 0) {
  console.log("📁 FILE SYSTEM ANALYSIS");
  console.log("─────────────────────────────────────────────────────────────────");

  // Files accessed
  const filesRead = new Set();
  const filesWritten = new Set();
  const filesStatted = new Set();

  fsEvents.forEach(e => {
    if (e.data.path) {
      if (e.data.call === "readFile" || e.data.call === "read") {
        filesRead.add(e.data.path);
      }
      if (e.data.call === "writeFile" || e.data.call === "write") {
        filesWritten.add(e.data.path);
      }
      if (e.data.call === "stat" || e.data.call === "lstat") {
        filesStatted.add(e.data.path);
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
    if (e.data.bytes_read) totalBytesRead += e.data.bytes_read;
    if (e.data.bytes_written) totalBytesWritten += e.data.bytes_written;
  });

  console.log(`\nData transfer:`);
  console.log(`  Bytes read:    ${totalBytesRead.toLocaleString()} (${formatBytes(totalBytesRead)})`);
  console.log(`  Bytes written: ${totalBytesWritten.toLocaleString()} (${formatBytes(totalBytesWritten)})`);

  // Directory operations
  const dirOps = fsEvents.filter(e => ["mkdir", "rmdir", "readdir"].includes(e.data.call));
  if (dirOps.length > 0) {
    console.log(`\nDirectory operations: ${dirOps.length}`);
    const dirs = new Set(dirOps.map(e => e.data.path).filter(Boolean));
    dirs.forEach(d => console.log(`  • ${d}`));
  }

  console.log();
}

// ============================================================================
// HTTP ANALYSIS
// ============================================================================

const fetchEvents = events.filter(e => e.ns === "fetch");
if (fetchEvents.length > 0) {
  console.log("🌐 HTTP ANALYSIS");
  console.log("─────────────────────────────────────────────────────────────────");

  const requests = fetchEvents.filter(e => e.data.call === "request");
  const responses = fetchEvents.filter(e => e.data.call === "response");

  console.log(`Total requests:  ${requests.length}`);
  console.log(`Total responses: ${responses.length}\n`);

  // Group by URL
  const byUrl = {};
  requests.forEach(r => {
    if (!byUrl[r.data.url]) {
      byUrl[r.data.url] = { requests: 0, method: r.data.method, responses: [] };
    }
    byUrl[r.data.url].requests++;
  });

  responses.forEach(r => {
    if (byUrl[r.data.url]) {
      byUrl[r.data.url].responses.push(r);
    }
  });

  console.log("Endpoints:");
  Object.entries(byUrl).forEach(([url, data]) => {
    console.log(`  ${data.method} ${url}`);
    console.log(`    Requests:  ${data.requests}`);
    console.log(`    Responses: ${data.responses.length}`);

    if (data.responses.length > 0) {
      const statuses = data.responses.map(r => r.data.status || "error");
      const statusCounts = {};
      statuses.forEach(s => {
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`      ${status}: ${count}`);
      });

      const totalBytes = data.responses.reduce((sum, r) => sum + (r.data.body_size || 0), 0);
      console.log(`      Total bytes: ${totalBytes.toLocaleString()} (${formatBytes(totalBytes)})`);
    }

    // Calculate timing
    const reqTimes = requests.filter(r => r.data.url === url).map(r => r.ts);
    const respTimes = data.responses.map(r => r.ts);
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
  const key = `${e.ns}.${e.data.call}.${e.data.path || e.data.url || ""}`;

  if (!operationPairs.has(key)) {
    operationPairs.set(key, { start: e.ts, events: [e] });
  } else {
    const pair = operationPairs.get(key);
    pair.events.push(e);
    pair.end = e.ts;
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
  .filter(e => e.data.call === "readFile")
  .forEach(e => {
    readCounts[e.data.path] = (readCounts[e.data.path] || 0) + 1;
  });
const repeatedReads = Object.entries(readCounts).filter(([_, count]) => count > 3);
if (repeatedReads.length > 0) {
  recommendations.push(`Repeated reads of same files: ${repeatedReads.map(([f, c]) => `${f} (${c}x)`).join(", ")}`);
}

// Check for HTTP requests in loops
if (fetchEvents.length > 10) {
  const urls = fetchEvents.filter(e => e.data.call === "request").map(e => e.data.url);
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
