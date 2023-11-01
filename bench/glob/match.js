import { run, bench, group } from "mitata";
import fg from "fast-glob";
import { Glob, Transpiler } from "bun";

const normalPattern = "*.ts";
const recursivePattern = "**/*.ts";

group({ name: "async", summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([normalPattern], {
      cwd: "src",
      followSymbolicLinks: false,
      onlyFiles: false,
    });
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob(normalPattern).match({
      cwd: "src",
    });
  });

  bench("Bun.Glob with dot", async () => {
    const entries = await new Glob(normalPattern).match({
      cwd: "src",
      dot: true,
    });
  });
});

group({ name: "async-recursive", summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([recursivePattern], {
      cwd: "src",
      followSymbolicLinks: false,
      onlyFiles: false,
    });
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob(recursivePattern).match({
      cwd: "src",
    });
  });

  bench("Bun.Glob with dot", async () => {
    const entries = await new Glob(recursivePattern).match({
      cwd: "src",
      dot: true,
    });
  });
});

group({ name: "sync", summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([normalPattern], {
      cwd: "src",
      followSymbolicLinks: false,
      onlyFiles: false,
    });
  });

  bench("Bun.Glob", () => {
    const entries = new Glob(normalPattern).matchSync({
      cwd: "src",
    });
  });

  bench("Bun.Glob with dot", () => {
    const entries = new Glob(normalPattern).matchSync({
      cwd: "src",
      dot: true,
    });
  });
});

group({ name: "sync-recursive", summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([recursivePattern], {
      cwd: "src",
      followSymbolicLinks: false,
      onlyFiles: false,
    });
  });

  bench("Bun.Glob", () => {
    const entries = new Glob(recursivePattern).matchSync({
      cwd: "src",
    });
  });

  bench("Bun.Glob with dot", () => {
    const entries = new Glob(recursivePattern).matchSync({
      cwd: "src",
      dot: true,
    });
  });
});

await run({
  avg: true,
  colors: true,
  min_max: true,
  collect: true,
  percentiles: true,
});
