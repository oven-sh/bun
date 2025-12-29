#!/usr/bin/env bun
/**
 * IPC JSON Chunked Benchmark
 *
 * This benchmark specifically tests the O(n²) scanning issue by forcing
 * data to arrive in small chunks. We use raw FD writes to bypass kernel
 * buffering that normally delivers complete messages.
 *
 * The O(n²) issue occurs when:
 * 1. Large message arrives in many small chunks
 * 2. Each chunk causes re-scanning of the entire accumulated buffer
 *
 * With the fix:
 * - Each byte is scanned at most once
 * - next() returns null if no complete message, avoiding redundant scans
 */

import { spawn } from "child_process";
import { writeSync } from "fs";

const CHUNK_SIZE = 64; // Small chunks to simulate fragmented delivery
const MESSAGE_SIZES = [
  { size: 1024, label: "1KB" },
  { size: 10 * 1024, label: "10KB" },
  { size: 100 * 1024, label: "100KB" },
  { size: 500 * 1024, label: "500KB" },
];
const NUM_MESSAGES = 5;

function createMessage(size) {
  const data = "x".repeat(size);
  return { type: "benchmark", data };
}

async function runBenchmark(messageSize) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, "child"], {
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });

    let receivedCount = 0;
    let startTime;
    const message = createMessage(messageSize);
    const messageJson = JSON.stringify(message) + "\n";
    const totalBytes = messageJson.length * NUM_MESSAGES;

    child.on("message", msg => {
      if (msg.type === "ready") {
        // Child is ready, start sending in chunks
        startTime = performance.now();

        for (let m = 0; m < NUM_MESSAGES; m++) {
          // Write message in small chunks to IPC channel FD
          // This simulates fragmented network delivery
          const ipcFd = child.channel.fd ?? child._channel?.fd ?? 3;

          for (let i = 0; i < messageJson.length; i += CHUNK_SIZE) {
            const chunk = messageJson.slice(i, Math.min(i + CHUNK_SIZE, messageJson.length));
            try {
              // Use the IPC channel's internal write mechanism
              child.send.__bunInternals?.write?.(chunk) ?? child.channel?.write?.(chunk) ?? writeSync(ipcFd, chunk);
            } catch (e) {
              // Fall back to buffered send if direct write fails
              if (i === 0) {
                child.send(message);
                break;
              }
            }
          }
        }
      } else if (msg.type === "ack") {
        receivedCount++;
        if (receivedCount >= NUM_MESSAGES) {
          const elapsed = performance.now() - startTime;
          child.kill();
          resolve({
            messageSize,
            messageSizeBytes: messageJson.length,
            numMessages: NUM_MESSAGES,
            totalBytes,
            elapsedMs: elapsed,
            throughputMBps: totalBytes / 1024 / 1024 / (elapsed / 1000),
            chunksPerMessage: Math.ceil(messageJson.length / CHUNK_SIZE),
          });
        }
      }
    });

    child.on("error", reject);
    child.on("exit", code => {
      if (code !== 0 && code !== null && receivedCount < NUM_MESSAGES) {
        reject(new Error(`Child exited with code ${code}`));
      }
    });

    // Timeout
    setTimeout(() => {
      child.kill();
      reject(new Error("Timeout"));
    }, 30000);
  });
}

async function main() {
  console.log("IPC JSON Chunked Benchmark (O(n²) stress test)");
  console.log("==============================================");
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Chunk size: ${CHUNK_SIZE} bytes`);
  console.log(`Messages per size: ${NUM_MESSAGES}`);
  console.log("");

  const results = [];

  for (const { size, label } of MESSAGE_SIZES) {
    process.stdout.write(`Testing ${label}... `);
    try {
      const result = await runBenchmark(size);
      results.push({ label, ...result });
      console.log(
        `${result.elapsedMs.toFixed(2)}ms (${result.throughputMBps.toFixed(2)} MB/s, ${result.chunksPerMessage} chunks/msg)`,
      );
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log("");
  console.log("Results Summary:");
  console.log("----------------");
  console.log("Size\t\tTime (ms)\tThroughput\tChunks/msg");
  for (const r of results) {
    console.log(
      `${r.label}\t\t${r.elapsedMs.toFixed(2)}\t\t${r.throughputMBps.toFixed(2)} MB/s\t${r.chunksPerMessage}`,
    );
  }
}

// Child process mode
if (process.argv[2] === "child") {
  let count = 0;
  process.on("message", msg => {
    count++;
    process.send({ type: "ack", count });
  });
  process.send({ type: "ready" });
} else {
  main().catch(console.error);
}
