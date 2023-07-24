import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { LightningCSSPlugin } from "../plugin";

const OUTPUT_DIR = path.join(import.meta.dir, "output");

beforeAll(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true });
});

function casesDir(...filePath: string[]) {
  return path.join(import.meta.dir, "cases", ...filePath);
}

function outDir(dir: string) {
  return path.join(OUTPUT_DIR, dir);
}

test("can import css", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css", "app.ts")],
    outdir: outDir("css"),
    plugins: [LightningCSSPlugin()],
  });
  expect(output.success).toBeTrue();
  expect(output.outputs).toHaveLength(2);
});

test("can import css modules", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css-modules", "app.ts")],
    outdir: outDir("css-modules"),
    plugins: [LightningCSSPlugin()],
  });
  expect(output.success).toBeTrue();
  expect(output.outputs).toHaveLength(2);
});

test("bundles css imports", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("with-imports", "app.ts")],
    outdir: outDir("with-imports"),
    plugins: [LightningCSSPlugin()],
  });
  expect(output.success).toBeTrue();
  expect(output.outputs).toHaveLength(2);
});

test("minifies css if minify config is set", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css", "app.ts")],
    minify: true,
    outdir: outDir("minify"),
    plugins: [LightningCSSPlugin()],
  });
  expect(output.success).toBeTrue();
  expect(output.outputs).toHaveLength(2);
});

describe("produces a source map if sourcemap config is set", async () => {
  test("inline", async () => {
    const output = await Bun.build({
      entrypoints: [casesDir("css", "app.ts")],
      sourcemap: "inline",
      outdir: outDir("sourcemap-inline"),
      plugins: [LightningCSSPlugin()],
    });
    expect(output.success).toBeTrue();
    expect(output.outputs).toHaveLength(2);
  });

  test("external", async () => {
    const output = await Bun.build({
      entrypoints: [casesDir("css", "app.ts")],
      sourcemap: "external",
      outdir: outDir("sourcemap-external"),
      plugins: [LightningCSSPlugin()],
    });
    expect(output.success).toBeTrue();
    expect(output.outputs).toHaveLength(4);
  });
});
