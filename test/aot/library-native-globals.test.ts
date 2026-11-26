// Bun's own modules read `setTimeout`, `URL`, `Blob` and their like from where script can't reach: a bare name in src/js is `@natives.<name>` (nativeGlobals and
// nativeFunctions in src/codegen/replacements.ts). So fake timers don't stop the timers of node:child_process, and a test that stores a class of its own on globalThis
// doesn't change what node:url answers. Compiled, the library read globalThis.
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(240_000);

const test = oneAtATime.concurrent;

const recording = `
const touched = new Set();
const record = (name, real) =>
  new Proxy(real, {
    apply(target, self, list) { touched.add(name); return Reflect.apply(target, self, list); },
    construct(target, list) { touched.add(name); return Reflect.construct(target, list); },
  });
`;

test("the timers of Bun's modules are not those that a test stores on globalThis", async () => {
  await expectCompiledToRunAsPlain({
    "timers.test.js": `
import { test } from "bun:test";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import * as promises from "node:timers/promises";
${recording}
test("replaces", async () => {
  const kept = [setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask];
  globalThis.setTimeout = record("setTimeout", setTimeout);
  globalThis.clearTimeout = record("clearTimeout", clearTimeout);
  globalThis.setInterval = record("setInterval", setInterval);
  globalThis.clearInterval = record("clearInterval", clearInterval);
  globalThis.setImmediate = record("setImmediate", setImmediate);
  globalThis.clearImmediate = record("clearImmediate", clearImmediate);
  globalThis.queueMicrotask = record("queueMicrotask", queueMicrotask);
  try {
    await new Promise(resolve => execFile("true", [], { timeout: 54321 }, resolve));
    await promises.setTimeout(1);
    await promises.setImmediate();
    for await (const _ of promises.setInterval(1)) break;
    await new Promise(resolve => createInterface({ input: Readable.from(["a\\n"]) }).on("close", resolve));
    console.log("the library:", [...touched].sort().join(" ") || "none");
    setTimeout(() => {}, 0);
    queueMicrotask(() => {});
    console.log("with the test's own calls:", [...touched].sort().join(" "));
  } finally {
    [globalThis.setTimeout, globalThis.clearTimeout, globalThis.setInterval, globalThis.clearInterval, globalThis.setImmediate, globalThis.clearImmediate, globalThis.queueMicrotask] = kept;
  }
});`,
  });
});

test("nor are its classes", async () => {
  await expectCompiledToRunAsPlain({
    "classes.test.js": `
import { test } from "bun:test";
import { pathToFileURL } from "node:url";
import { Readable, addAbortSignal, PassThrough } from "node:stream";
import { blob, text } from "node:stream/consumers";
import * as util from "node:util";
${recording}
test("replaces", async () => {
  const kept = [URL, Blob, TextDecoder, TextEncoder, AbortController];
  globalThis.URL = record("URL", URL);
  globalThis.Blob = record("Blob", Blob);
  globalThis.TextDecoder = record("TextDecoder", TextDecoder);
  globalThis.TextEncoder = record("TextEncoder", TextEncoder);
  globalThis.AbortController = record("AbortController", AbortController);
  try {
    console.log(pathToFileURL("/a/b").href, pathToFileURL("/a") instanceof kept[0]);
    console.log(await text(Readable.from(["a"])), (await blob(Readable.from(["a"]))) instanceof kept[1]);
    console.log(Readable.toWeb(Readable.from(["a"])).locked, util.transferableAbortController?.() instanceof kept[4]);
    addAbortSignal(new kept[4]().signal, new PassThrough());
    console.log("the library:", [...touched].sort().join(" ") || "none");
    new URL("http://a");
    console.log("with the test's own calls:", [...touched].sort().join(" "));
  } finally {
    [globalThis.URL, globalThis.Blob, globalThis.TextDecoder, globalThis.TextEncoder, globalThis.AbortController] = kept;
  }
});`,
  });
});

// A sandbox replaces these while a script runs: https://github.com/oven-sh/bun/issues/49616.
test("nor are FinalizationRegistry and WeakRef, nor the methods of their prototypes", async () => {
  await expectCompiledToRunAsPlain({
    "weak-references.test.js": `
import { expect, test } from "bun:test";
import { open } from "node:fs/promises";
import { aborted } from "node:util";
import { createContext } from "node:vm";
${recording}
test("replaces", async () => {
  const registry = FinalizationRegistry.prototype, weakRef = WeakRef.prototype;
  const kept = [FinalizationRegistry, WeakRef, registry.register, registry.unregister, weakRef.deref];
  globalThis.FinalizationRegistry = record("FinalizationRegistry", FinalizationRegistry);
  globalThis.WeakRef = record("WeakRef", WeakRef);
  registry.register = record("register", registry.register);
  registry.unregister = record("unregister", registry.unregister);
  weakRef.deref = record("deref", weakRef.deref);
  try {
    await (await open(import.meta.path)).close();
    const controller = new AbortController();
    const settled = aborted(controller.signal, {});
    controller.abort();
    await settled;
    for (let i = 0; i < 70; i++) createContext({});
    const target = {};
    process.finalization.register(target, () => {});
    process.finalization.unregister(target);
    const library = [...touched].sort().join(" ") || "none";
    console.log("the library:", library);
    new WeakRef({}).deref();
    console.log("with the test's own calls:", [...touched].sort().join(" "));
    expect(library).toBe("none");
  } finally {
    [globalThis.FinalizationRegistry, globalThis.WeakRef, registry.register, registry.unregister, weakRef.deref] = kept;
  }
});`,
  });
});
