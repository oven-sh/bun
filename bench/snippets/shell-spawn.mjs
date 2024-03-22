import { $ as zx } from "zx";
import { $ as execa$ } from "execa";
import { bench, run, group } from "./runner.mjs";

const execa = execa$({ stdio: "ignore", cwd: import.meta.dirname });

group("echo hi", () => {
  if (typeof Bun !== "undefined")
    bench("$`echo hi`", async () => {
      await Bun.$`echo hi`.quiet();
    });

  bench("execa`echo hi`", async () => {
    await execa`echo hi`;
  });

  bench("zx`echo hi`", async () => {
    await zx`echo hi`.quiet();
  });
});

group("ls .", () => {
  if (typeof Bun !== "undefined")
    bench("$`ls .`", async () => {
      await Bun.$`ls .`.quiet();
    });

  bench("execa`ls .`", async () => {
    await execa`ls .`;
  });

  bench("zx`ls .`", async () => {
    await zx`ls .`.quiet();
  });
});

await run();
