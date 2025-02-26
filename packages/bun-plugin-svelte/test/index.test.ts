import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import SveltePlugin from "..";

const fixturePath = (...segs: string[]) => path.join(import.meta.dirname, "fixtures", ...segs);

// temp dir that gets deleted after all tests
let outdir: string;

beforeAll(() => {
  const prefix = `svelte-test-${Math.random().toString(36).substring(2, 15)}`;
  outdir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
});

// afterAll(() => {
//   try {
//     fs.rmSync(outdir, { recursive: true, force: true });
//   } catch {
//     // suppress
//   }
// });

test("hello world component", async () => {
  const res = await Bun.build({
    entrypoints: [fixturePath("foo.svelte")],
    outdir,
    plugins: [SveltePlugin()],
  });
  expect(res.success).toBeTrue();
  console.log(res.outputs);
});
