/**
 * IPC JSON Performance Benchmark
 *
 * This benchmark tests the O(n²) scanning fix for JSON mode IPC.
 * We send many large messages immediately, then wait for all acks.
 * This causes data to accumulate in the buffer, triggering the O(n²) issue.
 */

import { spawn } from "node:child_process";

const MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const NUM_MESSAGES = 10;

function createMessage(size) {
  const data = "x".repeat(size);
  return { type: "benchmark", data };
}

async function runBenchmark() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, "child"], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    let receivedCount = 0;
    let startTime;
    const message = createMessage(MESSAGE_SIZE);
    const messageJson = JSON.stringify(message);

    child.on("message", msg => {
      if (msg.type === "ready") {
        // Child is ready, send ALL messages immediately
        startTime = performance.now();
        for (let i = 0; i < NUM_MESSAGES; i++) {
          child.send(message);
        }
      } else if (msg.type === "ack") {
        receivedCount++;
        if (receivedCount >= NUM_MESSAGES) {
          const elapsed = performance.now() - startTime;
          const totalBytes = messageJson.length * NUM_MESSAGES;
          child.kill();
          resolve({
            messageSize: MESSAGE_SIZE,
            messageSizeBytes: messageJson.length,
            numMessages: NUM_MESSAGES,
            totalBytes,
            elapsedMs: elapsed,
            throughputMBps: totalBytes / 1024 / 1024 / (elapsed / 1000),
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

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout - only received ${receivedCount}/${NUM_MESSAGES} messages`));
    }, 60000);
  });
}

async function main() {
  console.log("IPC JSON Performance Benchmark (O(n²) stress test)");
  console.log("===================================================");
  console.log(`Runtime: ${process.versions.bun ? "Bun " + process.versions.bun : "Node " + process.version}`);
  console.log(`Message size: ${(MESSAGE_SIZE / 1024 / 1024).toFixed(0)} MB`);
  console.log(`Number of messages: ${NUM_MESSAGES}`);
  console.log(`Total data: ${((MESSAGE_SIZE * NUM_MESSAGES) / 1024 / 1024).toFixed(0)} MB`);
  console.log("");

  process.stdout.write("Running benchmark... ");
  try {
    const result = await runBenchmark();
    console.log("done!");
    console.log("");
    console.log("Results:");
    console.log("--------");
    console.log(`Time: ${result.elapsedMs.toFixed(2)} ms`);
    console.log(`Throughput: ${result.throughputMBps.toFixed(2)} MB/s`);
    console.log("");
    console.log("JSON:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
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
