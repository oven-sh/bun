import { run, bench, group } from "mitata";
import fg from "fast-glob";
import { Glob, Transpiler } from "bun";

const normalPattern = "*.ts";
const recursivePattern = "**/*.ts";
const nodeModulesPattern = "**/node_modules/**/*.js";

const benchDot = false;
const cwd = undefined;

const fgOpts = {
  cwd,
  followSymbolicLinks: false,
  onlyFiles: false,
  // absolute: true,
};

group({ name: `async pattern="${normalPattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([normalPattern], fgOpts);
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob(normalPattern).match({
      cwd,
    });
  });

  if (benchDot)
    bench("Bun.Glob with dot", async () => {
      const entries = await new Glob(normalPattern).match({
        cwd,
        dot: true,
      });
    });
});

group({ name: `async-recursive pattern="${recursivePattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([recursivePattern], fgOpts);
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob(recursivePattern).match({
      cwd: "src",
    });
  });

  if (benchDot)
    bench("Bun.Glob with dot", async () => {
      const entries = await new Glob(recursivePattern).match({
        cwd,
        dot: true,
      });
    });
});

group({ name: `sync pattern="${normalPattern}"`, summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([normalPattern], fgOpts);
  });

  bench("Bun.Glob", () => {
    const entries = new Glob(normalPattern).matchSync({
      cwd,
    });
  });

  if (benchDot)
    bench("Bun.Glob with dot", () => {
      const entries = new Glob(normalPattern).matchSync({
        cwd,
        dot: true,
      });
    });
});

group({ name: `sync-recursive pattern="${recursivePattern}"`, summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([recursivePattern], fgOpts);
  });

  bench("Bun.Glob", () => {
    const entries = new Glob(recursivePattern).matchSync({
      cwd,
    });
  });

  if (benchDot)
    bench("Bun.Glob with dot", () => {
      const entries = new Glob(recursivePattern).matchSync({
        cwd,
        dot: true,
      });
    });
});

group({ name: `node_modules pattern="${nodeModulesPattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([nodeModulesPattern], fgOpts);
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob(nodeModulesPattern).match({
      cwd,
    });
  });

  if (benchDot)
    bench("Bun.Glob with dot", async () => {
      const entries = await new Glob(nodeModulesPattern).match({
        cwd,
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
