import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
const payloadToken = value =>
  value.inputTokens + value.outputTokens + (value.origin?.label ?? value.originLabel).length;

if (!isMainThread) {
  let count = 0;
  let checksum = 0;
  parentPort.on("message", message => {
    if (message?.__benchmark === "validate") {
      parentPort.postMessage(message.payload);
    } else if (message?.__benchmark === "barrier") {
      parentPort.postMessage({ count, checksum });
      count = 0;
      checksum = 0;
    } else if (message?.__benchmark === "close") {
      parentPort.close();
    } else {
      count++;
      checksum += payloadToken(message);
    }
  });
  parentPort.postMessage({ ready: true });
} else {
  const kind = "postMessage";
  const name = process.argv[2] ?? "nested-last";
  const encoding = process.argv[3] ?? "latin1";
  const size = process.argv[4] ?? "short";
  assert.ok(["nested-first", "nested-last", "flat"].includes(name));
  assert.ok(["latin1", "utf16"].includes(encoding));
  assert.ok(["short", "long"].includes(size));
  const unit = encoding === "latin1" ? "é" : "中";
  const prefix = size === "long" ? Buffer.alloc(Buffer.byteLength(unit) * 4096, unit).toString() : unit;
  const session = {
    sessionId: prefix,
    updatedAt: 1760000000000,
    sessionFile: prefix + "/session.jsonl",
    model: "fixture-model",
    provider: "fixture-provider",
    inputTokens: 1200,
    outputTokens: 640,
    totalTokens: 1840,
    contextTokens: 16384,
    label: prefix,
    channel: "fixture-channel",
    lastChannel: "fixture-channel",
    origin: {
      label: "Synthetic sender",
      provider: "fixture-provider",
      surface: "fixture-surface",
      chatType: "direct",
      from: "fixture:sender",
      to: "fixture:recipient",
      accountId: "fixture-account",
    },
    deliveryContext: { channel: "fixture-channel", to: "fixture:recipient", accountId: "fixture-account" },
    systemSent: true,
    abortedLastRun: false,
  };
  const { origin, deliveryContext, ...flat } = session;
  const payload =
    name === "flat"
      ? { ...flat, originLabel: origin.label, deliveryChannel: deliveryContext.channel }
      : name === "nested-first"
        ? { origin, deliveryContext, ...flat }
        : { ...flat, origin, deliveryContext };
  const expectedToken = payloadToken(payload);
  const shape = { operations: 250000, warmupOperations: 25000, batchSize: 1000 };
  let worker;
  let workerExitCode;
  let workerError;
  let sentNs = 0;
  let observedChecksum = 0;
  worker = new Worker(new URL(import.meta.url));
  // Record terminal events so an exit or error between waits cannot be missed.
  worker.on("error", error => {
    workerError = error;
  });
  worker.on("exit", code => {
    workerExitCode = code;
  });
  function waitFor(event, send) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (settle, value) => {
        clearTimeout(timer);
        worker.off(event, onEvent);
        worker.off("error", onError);
        worker.off("exit", onExit);
        settle(value);
      };
      const onEvent = (...args) => finish(resolve, args);
      const onError = error => finish(reject, error);
      const onExit = code => onError(new Error(`Worker exited before an acknowledgment: ${code}`));
      if (workerError) return onError(workerError);
      if (workerExitCode !== undefined) {
        return event === "exit" ? onEvent(workerExitCode) : onExit(workerExitCode);
      }
      worker.once(event, onEvent);
      worker.once("error", onError);
      if (event !== "exit") worker.once("exit", onExit);
      const timeoutMs = 60_000;
      timer = setTimeout(() => {
        onError(new Error(`Timed out waiting for worker ${event} after ${timeoutMs} ms`));
      }, timeoutMs);
      try {
        send?.();
      } catch (error) {
        onError(error);
      }
    });
  }
  async function phase(operations) {
    let ns = 0;
    let checksum = 0;
    const elapsedStart = performance.now();
    for (let offset = 0; offset < operations; offset += shape.batchSize) {
      const count = Math.min(shape.batchSize, operations - offset);
      const [receipt] = await waitFor("message", () => {
        const started = performance.now();
        for (let index = 0; index < count; index++) worker.postMessage(payload);
        ns += (performance.now() - started) * 1e6;
        worker.postMessage({ __benchmark: "barrier" });
      });
      assert.equal(receipt.count, count, "Worker did not consume every message");
      assert.equal(receipt.checksum, count * expectedToken, "Worker clone checksum differs");
      checksum += receipt.checksum;
    }
    assert.equal(checksum, operations * expectedToken);
    return { synchronousNs: ns, elapsedMs: performance.now() - elapsedStart, checksum };
  }
  try {
    const [ready] = await waitFor("message");
    assert.equal(ready.ready, true);
    const [copy] = await waitFor("message", () => {
      worker.postMessage({ __benchmark: "validate", payload });
    });
    assert.deepEqual(copy, payload, "Worker did not preserve the complete payload");
    await phase(shape.warmupOperations);
    const cpuBefore = process.cpuUsage();
    const memoryBefore = process.memoryUsage();
    const sample = await phase(shape.operations);
    sentNs = sample.synchronousNs;
    observedChecksum = sample.checksum;
    const cpu = process.cpuUsage(cpuBefore);
    const memoryAfter = process.memoryUsage();
    const maxRssKiB = process.resourceUsage().maxRSS;
    if (worker) {
      const [code] = await waitFor("exit", () => {
        worker.postMessage({ __benchmark: "close" });
      });
      assert.equal(code, 0, "Worker failed clean exit");
      worker = undefined;
    }
    console.log(
      JSON.stringify({
        schema: 1,
        kind,
        name,
        encoding,
        size,
        runtime: process.versions,
        operations: shape.operations,
        batchSize: shape.batchSize,
        warmupOperations: shape.warmupOperations,
        synchronousNs: sentNs,
        nsPerOperation: sentNs / shape.operations,
        elapsedMs: sample.elapsedMs,
        checksum: observedChecksum,
        expectedToken,
        cpuMicros: cpu,
        memoryBefore,
        memoryAfter,
        maxRssKiB,
        cleanExit: true,
      }),
    );
  } finally {
    if (worker) await worker.terminate();
  }
}
