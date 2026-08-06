// Probe bun (or node) for presence of APIs added in node (24.3, 26.3].
// Usage: <binary> [flags] /tmp/probe26.mjs
// Prints JSON: { runtime, revision, flags, results: { id: value } }
const out = {};
function t(id, fn) {
  try {
    out[id] = fn();
  } catch (e) {
    out[id] = `ERR:${e.code || e.name}:${String(e.message).slice(0, 80)}`;
  }
}
function req(m) {
  try {
    return require(m);
  } catch {
    return undefined;
  }
}

// --- globals
t("global.navigator.locks", () => typeof navigator?.locks);
t("global.QuotaExceededError", () => typeof globalThis.QuotaExceededError);
t("global.localStorage", () => typeof globalThis.localStorage);
t("global.sessionStorage", () => typeof globalThis.sessionStorage);

// --- worker_threads (Web Locks)
{
  const wt = req("node:worker_threads");
  t("worker_threads.locks", () => typeof wt.locks);
  t("worker_threads.Lock", () => typeof wt.Lock);
  t("worker_threads.LockManager", () => typeof wt.LockManager);
  t("worker_threads.locks.request", () => typeof wt.locks?.request);
  t("worker_threads.locks.query", () => typeof wt.locks?.query);
}

// --- crypto
{
  const c = req("node:crypto");
  t("crypto.encapsulate", () => typeof c.encapsulate);
  t("crypto.decapsulate", () => typeof c.decapsulate);
  t("crypto.argon2", () => typeof c.argon2);
  t("crypto.argon2Sync", () => typeof c.argon2Sync);
  t("crypto.argon2Sync.call", () => {
    try {
      const r = c.argon2Sync({
        algorithm: "argon2id",
        message: Buffer.from("pw"),
        nonce: Buffer.alloc(16),
        parallelism: 1,
        tagLength: 32,
        memory: 8,
        passes: 1,
      });
      return `works:${r?.constructor?.name}`;
    } catch (e) {
      return `throws:${e.code || e.name}`;
    }
  });
}

// --- diagnostics_channel
{
  const dc = req("node:diagnostics_channel");
  t("diagnostics_channel.boundedChannel", () => typeof dc.boundedChannel);
  t("diagnostics_channel.BoundedChannel", () => typeof dc.BoundedChannel);
  t("diagnostics_channel.BoundedChannelScope", () => typeof dc.BoundedChannelScope);
  t("diagnostics_channel.RunStoresScope", () => typeof dc.RunStoresScope);
  t("diagnostics_channel.Channel#withStoreScope", () => {
    const ch = dc.channel("probe26");
    return typeof ch.withStoreScope;
  });
  for (const m of ["hasSubscribers", "subscribe", "unsubscribe", "run", "withScope"]) {
    t(`diagnostics_channel.BoundedChannel#${m}`, () => {
      if (typeof dc.boundedChannel !== "function") return "n/a (no boundedChannel)";
      const ch = dc.boundedChannel("probe26b", 4);
      return typeof ch[m];
    });
  }
}

// --- async_hooks / async_context
{
  const ah = req("node:async_hooks");
  t("async_hooks.RunScope", () => typeof ah.RunScope);
  const ac = req("node:async_context");
  t("async_context(module)", () => (ac ? "exists" : "no-module"));
  if (ac) t("async_context.RunScope", () => typeof ac.RunScope);
  t("AsyncLocalStorage#withScope", () => {
    const als = new ah.AsyncLocalStorage();
    return typeof als.withScope;
  });
}

// --- process
t("process.addUncaughtExceptionCaptureCallback", () => typeof process.addUncaughtExceptionCaptureCallback);
t("process.setUncaughtExceptionCaptureCallback", () => typeof process.setUncaughtExceptionCaptureCallback);
t("process.permission", () => typeof process.permission);
t("process.permission.drop", () => typeof process.permission?.drop);
t("process.loadEnvFile", () => typeof process.loadEnvFile);
t("process.threadCpuUsage", () => typeof process.threadCpuUsage);
t("process.finalization", () => typeof process.finalization);
t("process.finalization.register", () => typeof process.finalization?.register);
t("process.features.typescript", () => JSON.stringify(process.features?.typescript));

// --- v8
{
  const v8 = req("node:v8");
  t("v8.startCpuProfile", () => typeof v8.startCpuProfile);
  t("v8.startHeapProfile", () => typeof v8.startHeapProfile);
  t("v8.CPUProfileHandle", () => typeof v8.CPUProfileHandle);
  t("v8.HeapProfileHandle", () => typeof v8.HeapProfileHandle);
  t("v8.SyncCPUProfileHandle", () => typeof v8.SyncCPUProfileHandle);
  t("v8.SyncHeapProfileHandle", () => typeof v8.SyncHeapProfileHandle);
}

// --- sqlite
{
  const sq = req("node:sqlite");
  t("sqlite(module)", () => (sq ? "exists" : "no-module"));
  if (sq) {
    t("sqlite.SQLTagStore", () => typeof sq.SQLTagStore);
    t("sqlite.DatabaseSync#createTagStore", () => typeof sq.DatabaseSync?.prototype?.createTagStore);
  }
}

// --- wasi
{
  const w = req("node:wasi");
  t("wasi(module)", () => (w ? "exists" : "no-module"));
  if (w) t("wasi.WASI#finalizeBindings", () => typeof w.WASI?.prototype?.finalizeBindings);
}

// --- inspector
{
  const insp = req("node:inspector");
  t("inspector(module)", () => (insp ? "exists" : "no-module"));
  if (insp) {
    t("inspector.Network", () => typeof insp.Network);
    for (const m of ["webSocketCreated", "webSocketHandshakeResponseReceived", "webSocketClosed"]) {
      t(`inspector.Network.${m}`, () => typeof insp.Network?.[m]);
    }
    t("inspector.DOMStorage", () => typeof insp.DOMStorage);
    for (const m of [
      "domStorageItemAdded",
      "domStorageItemRemoved",
      "domStorageItemUpdated",
      "domStorageItemsCleared",
      "registerStorage",
    ]) {
      t(`inspector.DOMStorage.${m}`, () => typeof insp.DOMStorage?.[m]);
    }
  }
}

// --- ffi
{
  const ffi = req("node:ffi");
  t("ffi(module)", () => (ffi ? "exists" : "no-module"));
  if (ffi) {
    for (const m of [
      "suffix", "dlopen", "dlclose", "dlsym", "DynamicLibrary", "toString", "toBuffer",
      "toArrayBuffer", "exportString", "exportBuffer", "exportArrayBuffer",
      "exportArrayBufferView", "getRawPointer",
    ]) {
      t(`ffi.${m}`, () => typeof ffi[m]);
    }
  }
}

// --- stream/iter (needs --experimental-stream-iter in both node and bun)
{
  const si = req("node:stream/iter");
  t("stream_iter(module)", () => (si ? "exists" : "no-module"));
  if (si) {
    t("stream_iter.exports", () => Object.keys(si).sort().join(","));
    t("stream_iter.Broadcast.from", () => typeof si.Broadcast?.from);
    t("stream_iter.Share.from", () => typeof si.Share?.from);
    t("stream_iter.SyncShare.fromSync", () => typeof si.SyncShare?.fromSync);
  }
  const zi = req("node:zlib/iter");
  t("zlib_iter(module)", () => (zi ? "exists" : "no-module"));
  if (zi) t("zlib_iter.exports", () => Object.keys(zi).sort().join(","));
}

// --- module
{
  const M = req("node:module");
  t("module.registerHooks", () => typeof M.registerHooks);
  t("module.findPackageJSON", () => typeof M.findPackageJSON);
  t("module.stripTypeScriptTypes", () => typeof M.stripTypeScriptTypes);
  t("module.register", () => typeof M.register);
}

// --- util
{
  const u = req("node:util");
  t("util.diff", () => typeof u.diff);
  t("util.getSystemErrorMessage", () => typeof u.getSystemErrorMessage);
}

const isBun = typeof Bun !== "undefined";
console.log(
  JSON.stringify(
    {
      runtime: isBun ? "bun" : "node",
      version: isBun ? Bun.version : process.version,
      revision: isBun ? Bun.revision : null,
      node_compat: process.versions.node,
      argv_flags: process.execArgv,
      results: out,
    },
    null,
    2,
  ),
);
