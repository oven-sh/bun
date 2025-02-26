import { describe, beforeAll, test, expect, afterEach, afterAll } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { render } from "svelte/server";
import { SveltePlugin } from "../src";

const fixturePath = (...segs: string[]) => path.join(import.meta.dirname, "fixtures", ...segs);

// temp dir that gets deleted after all tests
let outdir: string;

beforeAll(() => {
  const prefix = `svelte-test-${Math.random().toString(36).substring(2, 15)}`;
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
});

afterAll(() => {
  try {
    fs.rmSync(outdir, { recursive: true, force: true });
  } catch {
    // suppress
  }
});

test("hello world component", async () => {
  const res = await Bun.build({
    entrypoints: [fixturePath("foo.svelte")],
    outdir,
    plugins: [SveltePlugin()],
  });
  expect(res.success).toBeTrue();
});

describe("Bun.plugin", () => {
  afterEach(() => {
    Bun.plugin.clearAll();
  });

  test("using { forceSide: 'server' } allows for imported components to be SSR'd", async () => {
    expect(
      // setup() is sync
      Bun.plugin(SveltePlugin({ forceSide: "server" })),
    ).toBeUndefined();

    const foo = await import(fixturePath("foo.svelte"));
    expect(foo).toBeTypeOf("object");
    expect(foo).toHaveProperty("default");

    const actual = render(foo.default);
    expect(actual).toEqual(
      expect.objectContaining({
        head: expect.any(String),
        body: expect.any(String),
      }),
    );
    expect(actual.head).toMatchSnapshot("foo.svelte - head");
    expect(actual.body).toMatchSnapshot("foo.svelte - body");
  });
});
