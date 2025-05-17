import type { BuildOutput } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

describe("given a hello world component", () => {
  const entrypoints = [fixturePath("foo.svelte")];
  it("when no options are provided, builds successfully", async () => {
    const res = await Bun.build({
      entrypoints,
      outdir,
      plugins: [SveltePlugin()],
    });
    expect(res.success).toBeTrue();
  });

  describe("when a custom element is provided", () => {
    let res: BuildOutput;

    beforeAll(async () => {
      res = await Bun.build({
        entrypoints,
        outdir,
        plugins: [SveltePlugin({ compilerOptions: { customElement: true } })],
      });
    });

    it("builds successfully", () => {
      expect(res.success).toBeTrue();
    });
  });
});

describe("when importing `.svelte.ts` files with ESM", () => {
  let res: BuildOutput;

  beforeAll(async () => {
    res = await Bun.build({
      entrypoints: [fixturePath("with-modules.svelte")],
      outdir,
      plugins: [SveltePlugin()],
    });
  });

  it("builds successfully", () => {
    expect(res.success).toBeTrue();
  });

  it(`handles "svelte" export condition`, async () => {
    const res = await Bun.build({
      entrypoints: [fixturePath("svelte-export-condition.svelte")],
      outdir,
      plugins: [SveltePlugin()],
    });
    expect(res.success).toBeTrue();
  });
});

describe("when importing `.svelte.ts` files with CJS", () => {
  let res: BuildOutput;

  beforeAll(async () => {
    res = await Bun.build({
      entrypoints: [fixturePath("with-cjs.svelte")],
      outdir,
      plugins: [SveltePlugin()],
    });
  });

  it("builds successfully", () => {
    expect(res.success).toBeTrue();
  });

  it("does not double-wrap the module with function(module, exports, __filename, __dirname)", async () => {
    const ts = res.outputs.find(output => output.loader === "ts");
    expect(ts).toBeDefined();
    const code = await ts!.text();
    expect(code).toContain("require_todo_cjs_svelte");
    expect(code).toContain("var require_todo_cjs_svelte = __commonJS((exports, module) => {\n");
  });
});

describe("Bun.build", () => {
  it.each(["node", "bun"] as const)('Generates server-side code when targeting "node" or "bun"', async target => {
    const res = await Bun.build({
      entrypoints: [fixturePath("foo.svelte")],
      outdir,
      target,
      plugins: [SveltePlugin({ forceSide: "server" })],
    });
    expect(res.success).toBeTrue();
    const componentPath = res.outputs[0].path;
    const component = await import(componentPath);
    expect(component.default).toBeTypeOf("function");
    expect(render(component.default)).toMatchSnapshot(`foo.svelte - server-side (${target})`);
  });

  it("Generates client-side code when targeting 'browser'", async () => {
    const res = await Bun.build({
      entrypoints: [fixturePath("foo.svelte")],
      outdir,
      target: "browser",
    });

    expect(res.success).toBeTrue();
    const componentPath = path.resolve(res.outputs[0].path);
    const entrypoint = await res.outputs[0].text();
    expect(entrypoint).toMatchSnapshot(`foo.svelte - client-side index`);
    expect(await Bun.file(componentPath).text()).toMatchSnapshot(`foo.svelte - client-side`);
  });
});

describe("Bun.plugin", () => {
  afterEach(() => {
    Bun.plugin.clearAll();
  });

  // test.only("using { forceSide: 'server' } allows for imported components to be SSR'd", async () => {
  it("Generates server-side code", async () => {
    Bun.plugin(SveltePlugin());

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
