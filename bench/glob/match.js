import { run, bench, group } from "mitata";
import fg from "fast-glob";
import { Glob, Transpiler } from "bun";

group({ name: "async", summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob(["*.zig"], {
      cwd: "src",
    });
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob("*.zig").match({
      cwd: "src",
    });
  });
});

group({ name: "async-recursive", summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob(["**/*.ts"], {
      cwd: "src",
    });
  });

  bench("Bun.Glob", async () => {
    const entries = await new Glob("**/*.ts").match({
      cwd: "src",
    });
  });
});

group({ name: "sync", summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync(["*.zig"], {
      cwd: "src",
    });
  });

  bench("Bun.Glob", () => {
    const entries = new Glob("*.zig").matchSync({
      cwd: "src",
    });
  });
});

group({ name: "sync-recursive", summary: true }, () => {
  bench("fast-glob", () => {
    const entries = fg.globSync(["**/*.zig"], {
      cwd: "src",
    });
  });

  bench("Bun.Glob", () => {
    const entries = new Glob("**/*.zig").matchSync({
      cwd: "src",
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
