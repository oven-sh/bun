import { test } from "bun:test";
const tried = async load => {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log("failed", error.code ?? error.message.replace(import.meta.dir, ""));
  }
};
test("among-es-modules", async () => {
  await tried(() => import("./among-es-modules/root.mjs"));
  await globalThis.call;
  await tried(() => import("./among-es-modules/root.mjs"));
});
test("further-down", async () => {
  await tried(() => import("./further-down/root.mjs"));
  await globalThis.call;
  await tried(() => import("./further-down/root.mjs"));
});
test("behind-a-cycle", async () => {
  await tried(() => import("./behind-a-cycle/root.mjs"));
  await globalThis.call;
  await tried(() => import("./behind-a-cycle/root.mjs"));
});
test("inside-a-cycle", async () => {
  await tried(() => import("./inside-a-cycle/root.mjs"));
  await globalThis.call;
  await tried(() => import("./inside-a-cycle/root.mjs"));
});
test("below-a-cycle", async () => {
  await tried(() => import("./below-a-cycle/root.mjs"));
  await globalThis.call;
  await tried(() => import("./below-a-cycle/root.mjs"));
});
test("names-made-of-a-global", async () => {
  await tried(() => import("./names-made-of-a-global/root.mjs"));
  await globalThis.call;
  await tried(() => import("./names-made-of-a-global/root.mjs"));
});
test("names-as-they-were", async () => {
  await tried(() => import("./names-as-they-were/root.mjs"));
  await globalThis.call;
  await tried(() => import("./names-as-they-were/root.mjs"));
});
test("required-ahead-of-its-turn", async () => {
  await tried(() => import("./required-ahead-of-its-turn/root.mjs"));
  await globalThis.call;
  await tried(() => import("./required-ahead-of-its-turn/root.mjs"));
});
test("caught-ahead-of-its-turn", async () => {
  await tried(() => import("./caught-ahead-of-its-turn/root.mjs"));
  await globalThis.call;
  await tried(() => import("./caught-ahead-of-its-turn/root.mjs"));
});
test("an-es-module-throws", async () => {
  await tried(() => import("./an-es-module-throws/root.mjs"));
  await globalThis.call;
  await tried(() => import("./an-es-module-throws/root.mjs"));
});
test("a-commonjs-file-throws", async () => {
  await tried(() => import("./a-commonjs-file-throws/root.mjs"));
  await globalThis.call;
  await tried(() => import("./a-commonjs-file-throws/root.mjs"));
});
test("an-import-is-missing", async () => {
  await tried(() => import("./an-import-is-missing/root.mjs"));
  await globalThis.call;
  await tried(() => import("./an-import-is-missing/root.mjs"));
});
test("a-name-is-missing", async () => {
  await tried(() => import("./a-name-is-missing/root.mjs"));
  await globalThis.call;
  await tried(() => import("./a-name-is-missing/root.mjs"));
});
test("beside-an-await", async () => {
  await tried(() => import("./beside-an-await/root.mjs"));
  await globalThis.call;
  await tried(() => import("./beside-an-await/root.mjs"));
});
test("beside-an-importer-of-an-await", async () => {
  await tried(() => import("./beside-an-importer-of-an-await/root.mjs"));
  await globalThis.call;
  await tried(() => import("./beside-an-importer-of-an-await/root.mjs"));
});
test("jobs-and-ticks", async () => {
  await tried(() => import("./jobs-and-ticks/root.mjs"));
  await globalThis.call;
  await tried(() => import("./jobs-and-ticks/root.mjs"));
});
test("a-deferred-import", async () => {
  await tried(() => import("./a-deferred-import/root.mjs"));
  await globalThis.call;
  await tried(() => import("./a-deferred-import/root.mjs"));
});
test("a-call-below-a-require", async () => {
  await tried(() => import("./a-call-below-a-require/root.mjs"));
  await globalThis.call;
  await tried(() => import("./a-call-below-a-require/root.mjs"));
});
