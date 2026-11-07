import fg from "fast-glob";
import { fdir } from "fdir";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";

const normalPattern = "*.ts";
const recursivePattern = "**/*.ts";
const nodeModulesPattern = "**/node_modules/**/*.js";
const multiLevelPattern = "node_modules/*/lib/*.js";

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

group({ name: `multi-level pattern="${multiLevelPattern}"`, summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob([multiLevelPattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", async () => {
      const entries = await Array.fromAsync(new Glob(multiLevelPattern).scan(bunOpts));
    });

  if (benchFdir)
    bench("fdir", async () => {
      const entries = await new fdir().withFullPaths().glob(multiLevelPattern).crawl(process.cwd()).withPromise();
    });
});

group({ name: `sync multi-level pattern="${multiLevelPattern}"`, summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync([multiLevelPattern], fgOpts);
  });

  if (Glob)
    bench("Bun.Glob", () => {
      const entries = [...new Glob(multiLevelPattern).scanSync(bunOpts)];
    });

  if (benchFdir)
    bench("fdir", () => {
      const entries = new fdir().withFullPaths().glob(multiLevelPattern).crawl(process.cwd()).sync();
    });
});

// A last component without glob syntax: one lookup in each directory that `*` matches, no listing.
const literalTailCwd = mkdtempSync(join(tmpdir(), "bun-bench-glob-literal-tail-"));
process.on("exit", () => rmSync(literalTailCwd, { recursive: true, force: true }));
let literalTailSymlinks = true;
for (let i = 0; i < 1000; i++) {
  const dir = join(literalTailCwd, "packages", `p${i}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  try {
    if (literalTailSymlinks) symlinkSync("package.json", join(dir, "linked.json"));
  } catch {
    literalTailSymlinks = false;
  }
}

for (const onlyFiles of [true, false]) {
  for (const [kind, pattern] of [
    ["hit", "packages/*/package.json"],
    ["miss", "packages/*/missing.json"],
    ["symlink", "packages/*/linked.json"],
  ]) {
    if (kind === "symlink" && !literalTailSymlinks) continue;
    const opts = { cwd: literalTailCwd, onlyFiles };

    group(`sync literal tail ${kind} onlyFiles=${onlyFiles} pattern="${pattern}"`, () => {
      bench("fast-glob", () => {
        const entries = fg.globSync([pattern], opts);
      });

      if (Glob)
        bench("Bun.Glob", () => {
          const entries = [...new Glob(pattern).scanSync(opts)];
        });
    });
  }
}

await run({
  avg: true,
  colors: false,
  min_max: true,
  collect: true,
  percentiles: true,
});
