import fg from "fast-glob";
import { fdir } from "fdir";
import { bench, group, run } from "mitata";

const normalPattern = "*.ts";
const recursivePattern = "**/*.ts";
const nodeModulesPattern = "**/node_modules/**/*.js";

const benchFdir = false;
const cwd = undefined;

const bunOpts = {
  cwd,
  followSymlinks: false,
  absolute: true,
};

const fgOpts = {
  cwd,
  followSymbolicLinks: false,
  onlyFiles: false,
  absolute: true,
};

const Glob = "Bun" in globalThis ? globalThis.Bun.Glob : undefined;

group({ name: `async pattern="${normalPattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([normalPattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", async () => {
      const entries = await Array.fromAsync(new Glob(normalPattern).scan(bunOpts));
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = await new fdir().withFullPaths().glob(normalPattern).crawl(process.cwd()).withPromise();
    });
});

group({ name: `async-recursive pattern="${recursivePattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([recursivePattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", async () => {
      const entries = await Array.fromAsync(new Glob(recursivePattern).scan(bunOpts));
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = await new fdir().withFullPaths().glob(recursivePattern).crawl(process.cwd()).withPromise();
    });
});

group({ name: `sync pattern="${normalPattern}"`, summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([normalPattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", () => {
      const entries = [...new Glob(normalPattern).scanSync(bunOpts)];
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = new fdir().withFullPaths().glob(normalPattern).crawl(process.cwd()).sync();
    });
});

group({ name: `sync-recursive pattern="${recursivePattern}"`, summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([recursivePattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", () => {
      const entries = [...new Glob(recursivePattern).scanSync(bunOpts)];
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = new fdir().withFullPaths().glob(recursivePattern).crawl(process.cwd()).sync();
    });
});

group({ name: `node_modules pattern="${nodeModulesPattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([nodeModulesPattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", async () => {
      const entries = await Array.fromAsync(new Glob(nodeModulesPattern).scan(bunOpts));
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = await new fdir().withFullPaths().glob(nodeModulesPattern).crawl(process.cwd()).withPromise();
    });
});

await run({
  avg: true,
  colors: false,
  min_max: true,
  collect: true,
  percentiles: true,
});
