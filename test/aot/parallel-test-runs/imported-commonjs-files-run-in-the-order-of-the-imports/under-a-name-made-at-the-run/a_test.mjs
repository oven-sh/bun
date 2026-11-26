import { test } from "bun:test";
const tried = async load => {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log("failed", error.code ?? error.message);
  }
};
test.each([
  "among-es-modules",
  "further-down",
  "behind-a-cycle",
  "inside-a-cycle",
  "below-a-cycle",
  "names-made-of-a-global",
  "names-as-they-were",
  "required-ahead-of-its-turn",
  "caught-ahead-of-its-turn",
  "an-es-module-throws",
  "a-commonjs-file-throws",
  "an-import-is-missing",
  "a-name-is-missing",
  "beside-an-await",
  "beside-an-importer-of-an-await",
  "jobs-and-ticks",
  "a-deferred-import",
  "a-call-below-a-require"
])("%s", async name => {
  await tried(() => import(`./${name}/root.mjs`));
  await globalThis.call;
});
