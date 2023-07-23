import { describe, expect, test } from "bun:test";
import path from "node:path";
import { LightningCSSPlugin } from "../plugin";

Bun.plugin(LightningCSSPlugin());

function casesDir(...filePath: string[]) {
  return path.join(import.meta.dir, "cases", ...filePath);
}

function outDir(dir: string) {
  return path.join(import.meta.dir, "output", dir);
}

test("can import css", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css", "app.ts")],
    outdir: outDir("css"),
  });
  console.log(output.logs);
  expect(output.success).toBeTrue();

  console.log(output.outputs);
});

test("can import css modules", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css-modules", "app.ts")],
    outdir: outDir("css-modules"),
  });
  console.log(output.logs);
  expect(output.success).toBeTrue();

  console.log(output.outputs);
});

test("bundles css imports", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("with-imports", "app.ts")],
    outdir: outDir("with-imports"),
  });
  console.log(output.logs);
  expect(output.success).toBeTrue();

  console.log(output.outputs);
});

test("minifies css if minify config is set", async () => {
  const output = await Bun.build({
    entrypoints: [casesDir("css", "app.ts")],
    minify: true,
    outdir: outDir("minify"),
  });
  console.log(output.logs);
  expect(output.success).toBeTrue();

  console.log(output.outputs);
});

describe("produces a source map if sourcemap config is set", async () => {
  test("inline", async () => {
    const output = await Bun.build({
      entrypoints: [casesDir("css", "app.ts")],
      sourcemap: "inline",
      outdir: outDir("sourcemap-inline"),
    });
    console.log(output.logs);
    expect(output.success).toBeTrue();

    console.log(output.outputs);
  });

  test("external", async () => {
    const output = await Bun.build({
      entrypoints: [casesDir("css", "app.ts")],
      sourcemap: "external",
      outdir: outDir("sourcemap-external"),
    });
    console.log(output.logs);
    expect(output.success).toBeTrue();

    console.log(output.outputs);
  });
});
